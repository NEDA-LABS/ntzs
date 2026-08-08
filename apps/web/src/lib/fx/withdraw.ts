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

/**
 * True for errors ethers raises BEFORE anything is broadcast — gas estimation
 * reverts, a rejected call, insufficient native balance. Anything else around a
 * send (a timeout, a dropped connection) tells us nothing about whether the
 * transaction reached the mempool, and must not be reported as "it failed".
 */
export function isPreBroadcast(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  return code === 'CALL_EXCEPTION' || code === 'INSUFFICIENT_FUNDS' ||
    code === 'UNPREDICTABLE_GAS_LIMIT' || code === 'NONCE_EXPIRED' ||
    code === 'REPLACEMENT_UNDERPRICED' || code === 'INVALID_ARGUMENT'
}

const rpcMessage = (err: unknown) =>
  (err as { shortMessage?: string })?.shortMessage ||
  (err instanceof Error ? err.message : 'Unknown error')
export interface WithdrawResult {
  ok: boolean
  status?: number
  error?: string
  txHash?: string
  /** Broadcast succeeded but the confirmation was not observed. */
  confirmed?: boolean
  /** The transfer may or may not have been sent — a retry could pay twice. */
  indeterminate?: boolean
}

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

  let balance: bigint;
  try {
    balance = await contract.balanceOf(lp.walletAddress);
  } catch (err) {
    // Nothing has been sent at this point, so this one is safely retriable —
    // say so, rather than throwing and letting the client show "Network error".
    return {
      ok: false,
      status: 503,
      error: `Could not reach the ${chain === 'bnb' ? 'BNB Smart Chain' : 'Base'} network to check your balance (${rpcMessage(err)}). Nothing was sent — try again in a moment.`,
    };
  }
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

  let tx: Awaited<ReturnType<Contract['transfer']>>;
  try {
    tx = await contract.transfer(toAddress, amountWei);
  } catch (err) {
    if (isPreBroadcast(err)) {
      return { ok: false, status: 400, error: `The transfer was rejected before sending: ${rpcMessage(err)}` };
    }
    // The send may or may not have reached the mempool. Retrying could pay
    // twice, so this is reported as unresolved, not as a failure.
    return {
      ok: false,
      status: 502,
      indeterminate: true,
      error: `The network did not answer while sending (${rpcMessage(err)}). We cannot tell whether the transfer went out — check your wallet on the explorer before trying again.`,
    };
  }

  // Broadcast succeeded, so the money is on its way whatever happens next.
  let confirmed = true;
  try {
    await tx.wait(1);
  } catch (err) {
    confirmed = false;
    console.warn('[withdraw] broadcast but not confirmed:', tx.hash, rpcMessage(err));
  }

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

  // A transfer we sent but did not see confirm is still sent. Reporting it as
  // an error would invite a retry that pays the same address twice.
  return { ok: true, txHash: tx.hash, confirmed };
}
