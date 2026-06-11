import { NextRequest, NextResponse } from 'next/server';
import { generateOtp, storeOtp, sendOtpEmail } from '@/lib/merchant/otp';
import { OtpRateLimitError } from '@/lib/auth/otp-core';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'email required' }, { status: 400 });
    }

    const normalized = email.toLowerCase().trim();
    const code = generateOtp();
    await storeOtp(normalized, code);
    await sendOtpEmail(normalized, code);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    console.error('[merchant/request-otp]', err);
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 });
  }
}
