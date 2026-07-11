import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp } from '@/lib/merchant/otp';
import { createSession, setSessionCookie } from '@/lib/merchant/auth';
import { db } from '@/lib/merchant/db';
import { merchantAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';
import { provisionMerchantWallet, slugFromEmail } from '@/lib/merchant/wallet';

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

    let [merchant] = await db
      .select()
      .from(merchantAccounts)
      .where(eq(merchantAccounts.email, normalized))
      .limit(1);

    if (!merchant) {
      // Merchants are NEDApay users: new stores are created through the NEDApay
      // app (Biashara), where the owner's identity is already NIDA-verified.
      // This portal path auto-provisioned an HD wallet on first OTP login with
      // no KYC at all — the last unverified issuance path — so it is closed.
      // Existing merchants sign in unchanged.
      if (process.env.MERCHANT_SELF_SIGNUP_ENABLED !== 'true') {
        return NextResponse.json(
          {
            error: 'New merchant stores are created in the NEDApay app. Download NEDApay, verify your identity, and open Biashara to set up your store.',
            code: 'merchant_signup_moved',
          },
          { status: 403 }
        );
      }

      const { address, index } = await provisionMerchantWallet();

      // Ensure handle is unique by appending index if needed
      let handle = slugFromEmail(normalized) || `merchant${index}`;
      const [existing] = await db
        .select({ id: merchantAccounts.id })
        .from(merchantAccounts)
        .where(eq(merchantAccounts.handle, handle))
        .limit(1);
      if (existing) handle = `${handle}${index}`;

      [merchant] = await db
        .insert(merchantAccounts)
        .values({
          email: normalized,
          handle,
          walletAddress: address,
          walletIndex: index,
          onboardingStep: 1,
        })
        .returning();
    }

    const token = await createSession(merchant.id);
    await setSessionCookie(token);

    return NextResponse.json({ ok: true, merchantId: merchant.id, hasPassword: !!merchant.passwordHash });
  } catch (err) {
    console.error('[merchant/verify-otp]', err);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
