import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { sql } from 'drizzle-orm';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { depositRequests } from '@ntzs/db';
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env';

export const dynamic = 'force-dynamic';

// Live nTZS supply on Base = the liability the reserves must back 1:1.
async function getOnChainTotalSupply(): Promise<number> {
  if (!NTZS_CONTRACT_ADDRESS_BASE) return 0;
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
    const contract = new ethers.Contract(
      NTZS_CONTRACT_ADDRESS_BASE,
      ['function totalSupply() view returns (uint256)'],
      provider
    );
    const supply = await contract.totalSupply();
    return Number(ethers.formatUnits(supply, 18));
  } catch {
    return 0;
  }
}

// The bank's reserve monitor: nTZS issued (on-chain) vs the TZS that came in
// and minted it (the deposit-backed reserve). In a clean 1:1 system these
// match; the ratio surfaces any drift for the BoT-required oversight.
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [ntzsIssued, [agg]] = await Promise.all([
    getOnChainTotalSupply(),
    db
      .select({
        reserveTzs: sql<number>`coalesce(sum(case when ${depositRequests.status} = 'minted' then ${depositRequests.amountTzs} else 0 end), 0)`.mapWith(Number),
        pendingTzs: sql<number>`coalesce(sum(case when ${depositRequests.status} in ('submitted', 'mint_pending', 'mint_processing') then ${depositRequests.amountTzs} else 0 end), 0)`.mapWith(Number),
      })
      .from(depositRequests),
  ]);

  const reserveTzs = agg?.reserveTzs ?? 0;
  const pendingTzs = agg?.pendingTzs ?? 0;
  const ratio = ntzsIssued > 0 ? reserveTzs / ntzsIssued : 1;

  return NextResponse.json({
    ntzsIssued,
    reserveTzs,
    pendingTzs,
    ratio,
    asOf: new Date().toISOString(),
  });
}
