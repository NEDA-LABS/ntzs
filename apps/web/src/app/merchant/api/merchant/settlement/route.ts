import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/merchant/auth';
import { db } from '@/lib/merchant/db';
import { merchantAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';
import { isValidTanzanianPhone, normalizePhone } from '@/lib/psp/snippe';

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [merchant] = await db
    .select({ settlePct: merchantAccounts.settlePct, settlementPhone: merchantAccounts.settlementPhone })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, session.merchantId))
    .limit(1);

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ settlePct: merchant.settlePct, settlementPhone: merchant.settlementPhone });
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const settlePct = Number(body.settlePct);
  const settlementPhone = typeof body.settlementPhone === 'string' ? body.settlementPhone.trim() : null;

  if (!Number.isInteger(settlePct) || settlePct < 0 || settlePct > 100) {
    return NextResponse.json({ error: 'settlePct must be 0–100' }, { status: 400 });
  }

  if (settlePct > 0 && (!settlementPhone || !isValidTanzanianPhone(settlementPhone))) {
    return NextResponse.json({ error: 'Valid Tanzanian phone required for auto-settlement' }, { status: 400 });
  }

  await db
    .update(merchantAccounts)
    .set({
      settlePct,
      settlementPhone: settlementPhone ? normalizePhone(settlementPhone) : null,
      updatedAt: new Date(),
    })
    .where(eq(merchantAccounts.id, session.merchantId));

  return NextResponse.json({ ok: true });
}
