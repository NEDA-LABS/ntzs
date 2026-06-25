import { eq } from 'drizzle-orm';
import { JsonRpcProvider, Wallet, Contract, parseUnits, isAddress } from 'ethers';

import { db } from '@/lib/fx/db';
import { lpAccounts, lpWalletTransactions } from '@ntzs/db';
import { deriveWallet } from '@/lib/fx/lp-wallet';
import { getChainConfig, type ChainId } from '@/lib/fx/chainConfig';

const CHAIN_TOKENS: Record<ChainId, Record<string, { address: string; decimals: number }>> = {
  base: {
    ntzs: { address: '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688', decimals: 18 },
    usdc: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    usdt: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
  },
  bnb: {
    usdt: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  },
};

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

export interface WithdrawParams { token: string; toAddress: string; amount: string; chain?: ChainId }
export interface WithdrawResult { ok: boolean; status?: number; error?: string; txHash?: string }

/** Validate withdraw params without side effects. Returns an error string, or null. */
export function validateWithdrawParams(p: Partial<WithdrawParams>): string | null {
  const chain = (p.chain ?? 'base') as ChainId;
  if (!p.token || !p.toAddress || !p.amount) return 'token, toAddress and amount are required';
  const chainTokens = CHAIN_TOKENS[chain];
  if (!chainTokens) return `Unsupported chain: ${chain}`;
  const tc = chainTokens[p.token.toLowerCase()];
  if (!tc) return `token must be one of: ${Object.keys(chainTokens).join(', ')} on ${chain}`;
  if (!isAddress(p.toAddress)) return 'Invalid destination address';
  try {
    if (parseUnits(p.amount, tc.decimals) <= BigInt(0)) return 'Invalid amount';
  } catch {
    return 'Invalid amount';
  }
  return null;
}

/**
 * Send a token from the LP's wallet on-chain. Used by the withdraw route (owner /
 * approver direct path) and by the maker-checker approval flow (an operator's
 * withdrawal, once an approver approves). Self-validating; returns a plain result.
 */
export async function executeWithdraw(lpId: string, params: WithdrawParams): Promise<WithdrawResult> {
  const { token, toAddress, amount, chain = 'base' } = params;
  const validationError = validateWithdrawParams(params);
  if (validationError) return { ok: false, status: 400, error: validationError };

  const tokenConfig = CHAIN_TOKENS[chain][token.toLowerCase()];
  const amountWei = parseUnits(amount, tokenConfig.decimals);

  let chainCfg: ReturnType<typeof getChainConfig>;
  try {
    chainCfg = getChainConfig(chain);
  } catch (e) {
    return { ok: false, status: 503, error: (e as Error).message };
  }

  const [lp] = await db
    .select({ walletIndex: lpAccounts.walletIndex, walletAddress: lpAccounts.walletAddress, isActive: lpAccounts.isActive })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, lpId))
    .limit(1);
  if (!lp) return { ok: false, status: 404, error: 'LP account not found' };

  const { privateKey } = deriveWallet(lp.walletIndex);
  const provider = new JsonRpcProvider(chainCfg.rpcUrl);
  const signer = new Wallet(privateKey, provider);
  const contract = new Contract(tokenConfig.address, ERC20_ABI, signer);

  const balance: bigint = await contract.balanceOf(lp.walletAddress);
  if (balance < amountWei) {
    if (lp.isActive) {
      return {
        ok: false,
        status: 400,
        error: 'Your liquidity is in the pool while your account is active. Deactivate first to move funds back to your wallet, then withdraw.',
      };
    }
    return { ok: false, status: 400, error: 'Insufficient balance' };
  }

  // Top up native gas from the relayer if the LP wallet is low.
  try {
    const gasBalance: bigint = await provider.getBalance(lp.walletAddress);
    if (gasBalance < chainCfg.minGas && chainCfg.relayerKey) {
      const relayer = new Wallet(chainCfg.relayerKey, provider);
      const gasTx = await relayer.sendTransaction({ to: lp.walletAddress, value: chainCfg.minGas });
      await gasTx.wait(1);
    }
  } catch (gasErr) {
    console.warn('[withdraw] gas top-up failed (continuing):', gasErr instanceof Error ? gasErr.message : gasErr);
  }

  try {
    const tx = await contract.transfer(toAddress, amountWei);
    await tx.wait(1);

    await db.insert(lpWalletTransactions).values({
      lpId,
      chain,
      type: 'withdrawal',
      source: 'onchain',
      tokenAddress: tokenConfig.address,
      tokenSymbol: token.toUpperCase(),
      decimals: tokenConfig.decimals,
      amount,
      txHash: tx.hash,
    }).catch((err) => console.error('[withdraw] failed to record tx:', err));

    return { ok: true, txHash: tx.hash };
  } catch (err) {
    return { ok: false, status: 500, error: err instanceof Error ? err.message : 'Transaction failed' };
  }
}
