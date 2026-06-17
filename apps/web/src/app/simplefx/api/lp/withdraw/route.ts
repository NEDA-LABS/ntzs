import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts, lpWalletTransactions } from '@ntzs/db';
import { eq } from 'drizzle-orm';
import { deriveWallet } from '@/lib/fx/lp-wallet';
import { JsonRpcProvider, Wallet, Contract, parseUnits, isAddress } from 'ethers';
import { getChainConfig, type ChainId } from '@/lib/fx/chainConfig';
import { withIdempotency, getIdempotencyKey } from '@/lib/idempotency';

// Token configs per chain
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

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { token: string; toAddress: string; amount: string; chain?: ChainId };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { token, toAddress, amount, chain = 'base' } = body;

  if (!token || !toAddress || !amount) {
    return NextResponse.json({ error: 'token, toAddress and amount are required' }, { status: 400 });
  }

  const chainTokens = CHAIN_TOKENS[chain];
  if (!chainTokens) {
    return NextResponse.json({ error: `Unsupported chain: ${chain}` }, { status: 400 });
  }

  const tokenConfig = chainTokens[token.toLowerCase()];
  if (!tokenConfig) {
    return NextResponse.json({
      error: `token must be one of: ${Object.keys(chainTokens).join(', ')} on ${chain}`,
    }, { status: 400 });
  }

  if (!isAddress(toAddress)) {
    return NextResponse.json({ error: 'Invalid destination address' }, { status: 400 });
  }

  // Parse the amount up front so malformed input is a clean 400 (parseUnits
  // throws on bad decimals) rather than an unhandled 500 mid-transfer.
  let amountWei: bigint;
  try {
    amountWei = parseUnits(amount, tokenConfig.decimals);
  } catch {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }
  if (amountWei <= BigInt(0)) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }

  let chainCfg: ReturnType<typeof getChainConfig>;
  try {
    chainCfg = getChainConfig(chain);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }

  // Dedup the on-chain transfer so a client retry can't double-withdraw.
  return withIdempotency(`lp_withdraw:${session.lpId}`, getIdempotencyKey(req), async () => {
    const [lp] = await db
      .select({ walletIndex: lpAccounts.walletIndex, walletAddress: lpAccounts.walletAddress, isActive: lpAccounts.isActive })
      .from(lpAccounts)
      .where(eq(lpAccounts.id, session.lpId))
      .limit(1);

    if (!lp) return NextResponse.json({ error: 'LP account not found' }, { status: 404 });

    const { privateKey } = deriveWallet(lp.walletIndex);
    const provider = new JsonRpcProvider(chainCfg.rpcUrl);
    const signer = new Wallet(privateKey, provider);

    const contract = new Contract(tokenConfig.address, ERC20_ABI, signer);
    const balance: bigint = await contract.balanceOf(lp.walletAddress);

    if (balance < amountWei) {
      // While active, the LP's tokens live in the solver pool, not their wallet —
      // so a wallet-balance check looks empty. Give a useful next step instead of
      // a bare "Insufficient balance".
      if (lp.isActive) {
        return NextResponse.json({
          error: 'Your liquidity is in the pool while your account is active. Deactivate first to move funds back to your wallet, then withdraw.',
        }, { status: 400 });
      }
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
    }

    // The LP wallet needs native gas to send the transfer. Top it up from the
    // relayer if low, otherwise the transfer 500s with an opaque error.
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
        lpId: session.lpId,
        chain,
        type: 'withdrawal',
        source: 'onchain',
        tokenAddress: tokenConfig.address,
        tokenSymbol: token.toUpperCase(),
        decimals: tokenConfig.decimals,
        amount,
        txHash: tx.hash,
      }).catch((err) => console.error('[withdraw] failed to record tx:', err));

      return NextResponse.json({ txHash: tx.hash, status: 'confirmed', chain });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
