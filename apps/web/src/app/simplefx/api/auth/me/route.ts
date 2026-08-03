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
        accountType: lpAccounts.accountType,
        status: lpAccounts.status,
        kybStatus: lpAccounts.kybStatus,
        onboardingStep: lpAccounts.onboardingStep,
        kycStatus: lpAccounts.kycStatus,
        apiKeyHash: lpAccounts.apiKeyHash,
        createdAt: lpAccounts.createdAt,
        testAccessUntil: lpAccounts.testAccessUntil,
      })
      .from(lpAccounts)
      .where(eq(lpAccounts.id, session.lpId))
      .limit(1);

    if (!lp) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    // Lazy expiry for sandbox test access: the grant unlocks the portal
    // (status 'active') without KYB approval; once the window lapses, revert
    // to onboarding on the next portal load — self-healing, no cron needed.
    if (
      lp.status === 'active' &&
      lp.kybStatus !== 'approved' &&
      lp.testAccessUntil &&
      new Date(lp.testAccessUntil).getTime() < Date.now()
    ) {
      await db
        .update(lpAccounts)
        .set({ status: 'onboarding', testAccessUntil: null, updatedAt: new Date() })
        .where(eq(lpAccounts.id, session.lpId));
      lp.status = 'onboarding';
      lp.testAccessUntil = null;
    }

    const testAccessActive = !!lp.testAccessUntil && new Date(lp.testAccessUntil).getTime() > Date.now();

    const { apiKeyHash, ...lpData } = lp;
    return NextResponse.json({ lp: { ...lpData, testAccessActive, hasApiKey: !!apiKeyHash, role: session.role ?? 'owner' } });
  } catch (err) {
    console.error('[me]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
