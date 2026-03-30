import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp } from '@/lib/otp';
import { createSession, setSessionCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';
import { provisionLpWallet } from '@/lib/lp-wallet';

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();
    if (!email || !code) {
      return NextResponse.json({ error: 'email and code required' }, { status: 400 });
    }

    const valid = await verifyOtp(email, code);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 });
    }

    const normalized = email.toLowerCase().trim();

    let [lp] = await db
      .select()
      .from(lpAccounts)
      .where(eq(lpAccounts.email, normalized))
      .limit(1);

    if (!lp) {
      const { address, index } = await provisionLpWallet();
      [lp] = await db
        .insert(lpAccounts)
        .values({
          email: normalized,
          walletAddress: address,
          walletIndex: index,
          onboardingStep: 1,
        })
        .returning();
    }

    const token = await createSession(lp.id);
    await setSessionCookie(token);

    return NextResponse.json({ ok: true, lpId: lp.id });
  } catch (err) {
    console.error('[verify-otp]', err);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
