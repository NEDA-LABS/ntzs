import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const session = await getSessionFromCookies();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [lp] = await db
      .select({
        id: lpAccounts.id,
        email: lpAccounts.email,
        displayName: lpAccounts.displayName,
        walletAddress: lpAccounts.walletAddress,
        bidBps: lpAccounts.bidBps,
        askBps: lpAccounts.askBps,
        isActive: lpAccounts.isActive,
        onboardingStep: lpAccounts.onboardingStep,
        kycStatus: lpAccounts.kycStatus,
        apiKeyHash: lpAccounts.apiKeyHash,
        createdAt: lpAccounts.createdAt,
      })
      .from(lpAccounts)
      .where(eq(lpAccounts.id, session.lpId))
      .limit(1);

    if (!lp) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const { apiKeyHash, ...lpData } = lp;
    return NextResponse.json({ lp: { ...lpData, hasApiKey: !!apiKeyHash } });
  } catch (err) {
    console.error('[me]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
