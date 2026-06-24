import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp, consumeOtp } from '@/lib/fx/otp';
import { createSession, setSessionCookie } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts, lpMembers } from '@ntzs/db';
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

    // Resolve the org member by email (maker-checker identity). An email belongs to
    // exactly one member; existing accounts were back-filled as their own 'owner'.
    let [member] = await db
      .select()
      .from(lpMembers)
      .where(eq(lpMembers.email, normalized))
      .limit(1);

    if (member && member.status === 'disabled') {
      return NextResponse.json({ error: 'This account has been disabled. Contact your administrator.' }, { status: 403 });
    }

    let lp: typeof lpAccounts.$inferSelect | undefined;
    if (member) {
      [lp] = await db.select().from(lpAccounts).where(eq(lpAccounts.id, member.lpId)).limit(1);
      // First sign-in for an invited member activates them.
      if (member.status === 'invited') {
        await db.update(lpMembers).set({ status: 'active', updatedAt: new Date() }).where(eq(lpMembers.id, member.id));
      }
    } else {
      // Self-signup: provision the org account + an owner member.
      const { address, index } = await provisionLpWallet();
      [lp] = await db
        .insert(lpAccounts)
        .values({ email: normalized, walletAddress: address, walletIndex: index, onboardingStep: 1 })
        .returning();
      [member] = await db
        .insert(lpMembers)
        .values({ lpId: lp.id, email: normalized, role: 'owner', status: 'active' })
        .returning();

      const rpcUrl = process.env.BASE_RPC_URL;
      if (rpcUrl) {
        fundWalletWithGas({ toAddress: address, rpcUrl, amountEth: '0.0001' }).catch((err) =>
          console.warn('[verify-otp] gas prefund failed:', err instanceof Error ? err.message : err)
        );
      }
    }

    if (!lp || !member) {
      return NextResponse.json({ error: 'Could not resolve account' }, { status: 500 });
    }

    const token = await createSession(lp.id, { memberId: member.id, role: member.role });
    await setSessionCookie(token);

    // Mark OTP as used only after the full flow succeeds
    await consumeOtp(otpId);

    return NextResponse.json({ ok: true, lpId: lp.id, role: member.role });
  } catch (err) {
    console.error('[verify-otp]', err);
    return NextResponse.json({ error: 'Server error. Please try again.' }, { status: 500 });
  }
}
