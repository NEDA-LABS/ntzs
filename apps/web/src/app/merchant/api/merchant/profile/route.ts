import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/merchant/auth';
import { db } from '@/lib/merchant/db';
import { merchantAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const businessName = typeof body.businessName === 'string' ? body.businessName.trim() : undefined;

  if (!businessName) {
    return NextResponse.json({ error: 'businessName required' }, { status: 400 });
  }

  await db
    .update(merchantAccounts)
    .set({ businessName, updatedAt: new Date() })
    .where(eq(merchantAccounts.id, session.merchantId));

  return NextResponse.json({ ok: true });
}
