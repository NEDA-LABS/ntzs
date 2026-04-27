import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts, lpPoolPositions, lpFills, lpFxPairs } from '@ntzs/db';
import { eq, sql } from 'drizzle-orm';
import { JsonRpcProvider, Contract, formatUnits } from 'ethers';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

async function getOnChainBalance(provider: JsonRpcProvider, token: string, wallet: string): Promise<string> {
  const contract = new Contract(token, ERC20_ABI, provider);
  const [raw, decimals]: [bigint, bigint] = await Promise.all([
    contract.balanceOf(wallet),
    contract.decimals(),
  ]);
  return formatUnits(raw, Number(decimals));
}

/** Build a deduplicated token set from active lpFxPairs rows. */
function uniqueTokens(pairs: Array<{ token1Address: string; token1Symbol: string; token1Decimals: number; token2Address: string; token2Symbol: string; token2Decimals: number }>) {
  const map = new Map<string, { address: string; symbol: string; decimals: number }>()
  for (const p of pairs) {
    map.set(p.token1Address.toLowerCase(), { address: p.token1Address, symbol: p.token1Symbol, decimals: p.token1Decimals })
    map.set(p.token2Address.toLowerCase(), { address: p.token2Address, symbol: p.token2Symbol, decimals: p.token2Decimals })
  }
  return [...map.values()]
}

export async function GET() {
  try {
    const session = await getSessionFromCookies();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [lp, pairs] = await Promise.all([
      db
        .select({ walletAddress: lpAccounts.walletAddress, isActive: lpAccounts.isActive })
        .from(lpAccounts)
        .where(eq(lpAccounts.id, session.lpId))
        .limit(1)
        .then((r) => r[0]),
      db.select().from(lpFxPairs).where(eq(lpFxPairs.isActive, true)),
    ]);

    if (!lp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const tokens = uniqueTokens(pairs);
    const rpcUrl = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org';
    const provider = new JsonRpcProvider(rpcUrl);

    if (lp.isActive) {
      // LP is in the pool — contributed from pool positions, earned from lpFills (authoritative)
      const [positions, fillTotals] = await Promise.all([
        db.select().from(lpPoolPositions).where(eq(lpPoolPositions.lpId, session.lpId)),
        db
          .select({
            toToken: lpFills.toToken,
            totalEarned: sql<string>`SUM(${lpFills.spreadEarned})`,
          })
          .from(lpFills)
          .where(eq(lpFills.lpId, session.lpId))
          .groupBy(lpFills.toToken),
      ]);

      const earnedByAddr: Record<string, string> = {};
      for (const f of fillTotals) {
        earnedByAddr[f.toToken.toLowerCase()] = f.totalEarned ?? '0';
      }

      const byToken: Record<string, { contributed: string; earned: string; total: string }> = {};
      for (const pos of positions) {
        const sym = pos.tokenSymbol.toLowerCase();
        const contributed = parseFloat(pos.contributed);
        const earned = parseFloat(earnedByAddr[pos.tokenAddress.toLowerCase()] ?? pos.earned);
        byToken[sym] = {
          contributed: pos.contributed,
          earned: earned.toString(),
          total: (contributed + earned).toString(),
        };
      }

      // LP wallet on-chain balances across all active tokens (unsent funds)
      const walletBalances = await Promise.all(
        tokens.map(async (t) => [t.symbol.toLowerCase(), await getOnChainBalance(provider, t.address, lp.walletAddress)] as const)
      );
      const wallet = Object.fromEntries(walletBalances);

      return NextResponse.json({
        source: 'pool',
        ntzs: byToken['ntzs']?.total ?? '0',
        usdc: byToken['usdc']?.total ?? '0',
        usdt: byToken['usdt']?.total ?? '0',
        positions: byToken,
        wallet,
      });
    } else {
      // LP not yet active — show on-chain wallet balances for all active tokens
      const walletBalances = await Promise.all(
        tokens.map(async (t) => [t.symbol.toLowerCase(), await getOnChainBalance(provider, t.address, lp.walletAddress)] as const)
      );
      const walletBySymbol = Object.fromEntries(walletBalances);

      return NextResponse.json({
        source: 'wallet',
        ntzs: walletBySymbol['ntzs'] ?? '0',
        usdc: walletBySymbol['usdc'] ?? '0',
        usdt: walletBySymbol['usdt'] ?? '0',
        ...walletBySymbol,
      });
    }
  } catch (err) {
    console.error('[balances]', err);
    return NextResponse.json({ ntzs: '0', usdc: '0', usdt: '0' });
  }
}
