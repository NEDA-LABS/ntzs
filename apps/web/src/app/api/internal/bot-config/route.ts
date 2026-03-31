import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { lpFxConfig, lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const secret = process.env.INTERNAL_API_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { db } = getDb();

  const [config] = await db
    .select()
    .from(lpFxConfig)
    .where(eq(lpFxConfig.id, 1))
    .limit(1);

  const [lp] = await db
    .select({ bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
    .from(lpAccounts)
    .where(eq(lpAccounts.walletIndex, 0))
    .limit(1);

  return NextResponse.json({
    midRateTZS: config?.midRateTZS ?? 3750,
    bidBps: lp?.bidBps ?? 120,
    askBps: lp?.askBps ?? 150,
  });
}
