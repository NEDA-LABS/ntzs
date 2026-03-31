import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { db } from '@/lib/db';
import { lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { amountTzs, phoneNumber } = await req.json();

  if (!amountTzs || !phoneNumber) {
    return NextResponse.json({ error: 'amountTzs and phoneNumber are required' }, { status: 400 });
  }

  // Get LP wallet address and email
  const [lp] = await db
    .select({ walletAddress: lpAccounts.walletAddress, email: lpAccounts.email })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, session.lpId))
    .limit(1);

  if (!lp) return NextResponse.json({ error: 'LP account not found' }, { status: 404 });

  const ntzs_api = process.env.NTZS_API_BASE_URL;
  const secret = process.env.INTERNAL_API_SECRET;

  if (!ntzs_api || !secret) {
    return NextResponse.json({ error: 'Minting service not configured' }, { status: 503 });
  }

  const res = await fetch(`${ntzs_api}/api/internal/lp-deposit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${secret}`,
    },
    body: JSON.stringify({
      walletAddress: lp.walletAddress,
      amountTzs,
      phoneNumber,
      lpEmail: lp.email,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json({ error: data.error || 'Minting failed' }, { status: res.status });
  }

  return NextResponse.json(data, { status: 201 });
}
