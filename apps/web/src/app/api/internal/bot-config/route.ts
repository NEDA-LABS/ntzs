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

  const [pairs, activeLps] = await Promise.all([
    db.select().from(lpFxPairs).where(eq(lpFxPairs.isActive, true)),
    db
      .select({ bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
      .from(lpAccounts)
      .where(eq(lpAccounts.isActive, true)),
  ]);

  // Mean spread across all active LPs; fall back to safe defaults if none active yet
  const activeLpCount = activeLps.length;
  const bidBps = activeLpCount > 0
    ? Math.round(activeLps.reduce((sum, lp) => sum + lp.bidBps, 0) / activeLpCount)
    : 120;
  const askBps = activeLpCount > 0
    ? Math.round(activeLps.reduce((sum, lp) => sum + lp.askBps, 0) / activeLpCount)
    : 150;

  return NextResponse.json({
    bidBps,
    askBps,
    activeLpCount,
    pairs: pairs.map((p) => ({
      token1Address: p.token1Address,
      token1Symbol: p.token1Symbol,
      token2Address: p.token2Address,
      token2Symbol: p.token2Symbol,
      midRate: Number(p.midRate),
    })),
  });
}
