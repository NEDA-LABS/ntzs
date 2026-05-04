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
