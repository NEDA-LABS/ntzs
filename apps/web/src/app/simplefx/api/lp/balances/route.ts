import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts, lpPoolPositions, lpFills, lpFxPairs } from '@ntzs/db';
import { eq, sql } from 'drizzle-orm';
import { JsonRpcProvider, Contract, formatUnits } from 'ethers';
import { getChainConfig, type ChainId } from '@/lib/fx/chainConfig';

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

    // Group tokens by chain from active pairs
    const tokensByChain = new Map<ChainId, Map<string, { address: string; symbol: string; decimals: number }>>()
    for (const p of pairs) {
      const chain = (p.chain ?? 'base') as ChainId
      if (!tokensByChain.has(chain)) tokensByChain.set(chain, new Map())
      const map = tokensByChain.get(chain)!
      map.set(p.token1Address.toLowerCase(), { address: p.token1Address, symbol: p.token1Symbol, decimals: p.token1Decimals })
      map.set(p.token2Address.toLowerCase(), { address: p.token2Address, symbol: p.token2Symbol, decimals: p.token2Decimals })
    }

    if (lp.isActive) {
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

      // Aggregate positions by token symbol (across chains)
      const byToken: Record<string, { contributed: string; earned: string; total: string }> = {};
      for (const pos of positions) {
        const sym = pos.tokenSymbol.toLowerCase();
        const contributed = parseFloat(pos.contributed);
        const earned = parseFloat(earnedByAddr[pos.tokenAddress.toLowerCase()] ?? pos.earned);
        const prev = byToken[sym]
        if (prev) {
          byToken[sym] = {
            contributed: (parseFloat(prev.contributed) + contributed).toString(),
            earned: (parseFloat(prev.earned) + earned).toString(),
            total: (parseFloat(prev.total) + contributed + earned).toString(),
          }
        } else {
          byToken[sym] = {
            contributed: pos.contributed,
            earned: earned.toString(),
            total: (contributed + earned).toString(),
          };
        }
      }

      // Wallet balances per chain
      const walletBySymbol: Record<string, string> = {}
      await Promise.all(
        [...tokensByChain.entries()].map(async ([chain, tokenMap]) => {
          let cfg: ReturnType<typeof getChainConfig>
          try { cfg = getChainConfig(chain) } catch { return }
          const provider = new JsonRpcProvider(cfg.rpcUrl)
          const results = await Promise.all(
            [...tokenMap.values()].map(async (t) => {
              const bal = await getOnChainBalance(provider, t.address, lp.walletAddress).catch(() => '0')
              return { sym: t.symbol.toLowerCase(), bal }
            })
          )
          for (const { sym, bal } of results) {
            walletBySymbol[sym] = (parseFloat(walletBySymbol[sym] ?? '0') + parseFloat(bal)).toString()
          }
        })
      )

      return NextResponse.json({
        source: 'pool',
        ntzs: byToken['ntzs']?.total ?? '0',
        usdc: byToken['usdc']?.total ?? '0',
        usdt: byToken['usdt']?.total ?? '0',
        positions: byToken,
        wallet: walletBySymbol,
      });
    } else {
      // LP not active — show on-chain wallet balances per chain
      const walletBySymbol: Record<string, string> = {}
      await Promise.all(
        [...tokensByChain.entries()].map(async ([chain, tokenMap]) => {
          let cfg: ReturnType<typeof getChainConfig>
          try { cfg = getChainConfig(chain) } catch { return }
          const provider = new JsonRpcProvider(cfg.rpcUrl)
          const results = await Promise.all(
            [...tokenMap.values()].map(async (t) => {
              const bal = await getOnChainBalance(provider, t.address, lp.walletAddress).catch(() => '0')
              return { sym: t.symbol.toLowerCase(), bal }
            })
          )
          for (const { sym, bal } of results) {
            walletBySymbol[sym] = (parseFloat(walletBySymbol[sym] ?? '0') + parseFloat(bal)).toString()
          }
        })
      )

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
