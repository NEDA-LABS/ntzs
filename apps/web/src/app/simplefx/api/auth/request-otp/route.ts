import { NextRequest, NextResponse } from 'next/server';
import { generateOtp, storeOtp, sendOtpEmail } from '@/lib/fx/otp';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const code = generateOtp();
    await storeOtp(email, code);
    await sendOtpEmail(email, code);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[request-otp]', err);
    return NextResponse.json({ error: 'Failed to send code' }, { status: 500 });
  }
}
