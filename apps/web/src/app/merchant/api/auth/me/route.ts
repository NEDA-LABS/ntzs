import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/merchant/auth';
import { db } from '@/lib/merchant/db';
import { merchantAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [merchant] = await db
    .select({
      id: merchantAccounts.id,
      email: merchantAccounts.email,
      businessName: merchantAccounts.businessName,
      handle: merchantAccounts.handle,
      walletAddress: merchantAccounts.walletAddress,
      settlePct: merchantAccounts.settlePct,
      settlementPhone: merchantAccounts.settlementPhone,
      isActive: merchantAccounts.isActive,
      onboardingStep: merchantAccounts.onboardingStep,
      createdAt: merchantAccounts.createdAt,
      passwordHash: merchantAccounts.passwordHash,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, session.merchantId))
    .limit(1);

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { passwordHash, ...rest } = merchant;
  return NextResponse.json({ merchant: { ...rest, hasPassword: !!passwordHash } });
}
