import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { lpFxPairs, lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const secret = process.env.INTERNAL_API_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { db } = getDb();

  const pairs = await db
    .select()
    .from(lpFxPairs)
    .where(eq(lpFxPairs.isActive, true));

  const [lp] = await db
    .select({ bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
    .from(lpAccounts)
    .where(eq(lpAccounts.walletIndex, 0))
    .limit(1);

  return NextResponse.json({
    bidBps: lp?.bidBps ?? 120,
    askBps: lp?.askBps ?? 150,
    pairs: pairs.map((p) => ({
      token1Address: p.token1Address,
      token1Symbol: p.token1Symbol,
      token2Address: p.token2Address,
      token2Symbol: p.token2Symbol,
      midRate: Number(p.midRate),
    })),
  });
}
