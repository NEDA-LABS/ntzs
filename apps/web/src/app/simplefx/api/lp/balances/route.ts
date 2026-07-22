import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts, lpPoolPositions, lpFills } from '@ntzs/db';
import { eq, sql } from 'drizzle-orm';
import { JsonRpcProvider, Contract, formatUnits } from 'ethers';
import { getChainConfig, getChainTokens, CHAIN_TOKENS, type ChainId } from '@/lib/fx/chainConfig';

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

/**
 * Read the LP wallet's on-chain balances on EVERY configured chain.
 *
 * Deliberately independent of lp_fx_pairs: pair rows control what can SWAP,
 * not what the LP OWNS. (Deactivating the only bnb pair used to make BNB-side
 * holdings vanish from the dashboard — 650 USDT "went missing" on 21 Jul.)
 * A chain whose RPC isn't configured is skipped with a log, never an error.
 */
async function fetchWalletBalances(walletAddress: string) {
  const walletByChain: Partial<Record<ChainId, Record<string, string>>> = {};
  const walletBySymbol: Record<string, string> = {};

  await Promise.all(
    (Object.keys(CHAIN_TOKENS) as ChainId[]).map(async (chain) => {
      let cfg: ReturnType<typeof getChainConfig>;
      try { cfg = getChainConfig(chain); } catch (e) {
        console.error(`[balances] chain config missing for ${chain}:`, e);
        return;
      }
      const provider = new JsonRpcProvider(cfg.rpcUrl);
      const results = await Promise.all(
        Object.values(getChainTokens(chain)).map(async (t) => {
          const bal = await getOnChainBalance(provider, t.address, walletAddress).catch((e) => {
            console.error(`[balances] balanceOf failed for ${t.symbol} on ${chain}:`, e);
            return '0';
          });
          return { sym: t.symbol.toLowerCase(), bal };
        })
      );
      const chainMap: Record<string, string> = {};
      for (const { sym, bal } of results) {
        chainMap[sym] = bal;
        walletBySymbol[sym] = (parseFloat(walletBySymbol[sym] ?? '0') + parseFloat(bal)).toString();
      }
      walletByChain[chain] = chainMap;
    })
  );

  return { walletByChain, walletBySymbol };
}

export async function GET() {
  try {
    const session = await getSessionFromCookies();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [lp] = await db
      .select({ walletAddress: lpAccounts.walletAddress, isActive: lpAccounts.isActive })
      .from(lpAccounts)
      .where(eq(lpAccounts.id, session.lpId))
      .limit(1);

    if (!lp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (lp.isActive) {
      const [positions, fillTotals, walletBalances] = await Promise.all([
        db.select().from(lpPoolPositions).where(eq(lpPoolPositions.lpId, session.lpId)),
        db
          .select({
            toToken: lpFills.toToken,
            totalEarned: sql<string>`SUM(${lpFills.spreadEarned})`,
          })
          .from(lpFills)
          .where(eq(lpFills.lpId, session.lpId))
          .groupBy(lpFills.toToken),
        fetchWalletBalances(lp.walletAddress),
      ]);

      const earnedByAddr: Record<string, string> = {};
      for (const f of fillTotals) {
        earnedByAddr[f.toToken.toLowerCase()] = f.totalEarned ?? '0';
      }

      // Aggregate positions by token symbol (across chains) plus a per-chain
      // breakdown so the UI can label where each pooled balance lives.
      const byToken: Record<string, { contributed: string; earned: string; total: string }> = {};
      const positionsByChain: Record<string, Record<string, { contributed: string; earned: string; total: string }>> = {};
      for (const pos of positions) {
        const sym = pos.tokenSymbol.toLowerCase();
        const contributed = parseFloat(pos.contributed);
        const earned = parseFloat(earnedByAddr[pos.tokenAddress.toLowerCase()] ?? pos.earned);
        const prev = byToken[sym]
        // `total` == `contributed`: under double-entry fill accounting the LP's
        // realized profit is already inside `contributed`, so adding `earned` would
        // double-count. `earned` (from lpFills) is kept as an informational figure —
        // how much of the balance is lifetime spread — not added to the total.
        if (prev) {
          byToken[sym] = {
            contributed: (parseFloat(prev.contributed) + contributed).toString(),
            earned: (parseFloat(prev.earned) + earned).toString(),
            total: (parseFloat(prev.total) + contributed).toString(),
          }
        } else {
          byToken[sym] = {
            contributed: pos.contributed,
            earned: earned.toString(),
            total: contributed.toString(),
          };
        }

        const chainKey = (pos.chain ?? 'base') as string;
        (positionsByChain[chainKey] ??= {})[sym] = {
          contributed: pos.contributed,
          earned: earned.toString(),
          total: contributed.toString(),
        };
      }

      return NextResponse.json({
        source: 'pool',
        ntzs: byToken['ntzs']?.total ?? '0',
        usdc: byToken['usdc']?.total ?? '0',
        usdt: byToken['usdt']?.total ?? '0',
        positions: byToken,
        positionsByChain,
        wallet: walletBalances.walletBySymbol,
        walletByChain: walletBalances.walletByChain,
      });
    } else {
      // LP not active — on-chain wallet balances across every configured chain
      const { walletByChain, walletBySymbol } = await fetchWalletBalances(lp.walletAddress);

      return NextResponse.json({
        source: 'wallet',
        ntzs: walletBySymbol['ntzs'] ?? '0',
        usdc: walletBySymbol['usdc'] ?? '0',
        usdt: walletBySymbol['usdt'] ?? '0',
        ...walletBySymbol,
        wallet: walletBySymbol,
        walletByChain,
      });
    }
  } catch (err) {
    console.error('[balances]', err);
    return NextResponse.json({ ntzs: '0', usdc: '0', usdt: '0' });
  }
}
