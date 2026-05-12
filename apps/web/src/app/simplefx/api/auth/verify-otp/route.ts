import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp, consumeOtp } from '@/lib/fx/otp';
import { createSession, setSessionCookie } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';
import { provisionLpWallet } from '@/lib/fx/lp-wallet';
import { fundWalletWithGas } from '@/lib/waas/hd-wallets';

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();
    if (!email || !code) {
      return NextResponse.json({ error: 'email and code required' }, { status: 400 });
    }

    const otpId = await verifyOtp(email, code);
    if (!otpId) {
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

      const rpcUrl = process.env.BASE_RPC_URL;
      if (rpcUrl) {
        fundWalletWithGas({ toAddress: address, rpcUrl, amountEth: '0.0001' }).catch((err) =>
          console.warn('[verify-otp] gas prefund failed:', err instanceof Error ? err.message : err)
        );
      }
    }

    const token = await createSession(lp.id);
    await setSessionCookie(token);

    // Mark OTP as used only after the full flow succeeds
    await consumeOtp(otpId);

    return NextResponse.json({ ok: true, lpId: lp.id });
  } catch (err) {
    console.error('[verify-otp]', err);
    return NextResponse.json({ error: 'Server error. Please try again.' }, { status: 500 });
  }
}
