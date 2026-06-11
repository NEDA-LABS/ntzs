import { randomInt } from 'crypto';
import { db } from './db';
import { merchantOtpCodes } from '@ntzs/db';
import { and, eq, lte } from 'drizzle-orm';
import { enforceOtpIssuanceLimit, hashOtp, verifyOtpCode } from '@/lib/auth/otp-core';

export function generateOtp(): string {
  return String(randomInt(100000, 999999));
}

export { hashOtp };

export async function storeOtp(email: string, code: string): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  const normalized = email.toLowerCase();

  // Throttle issuance before minting a new code (anti brute-force / anti-bomb).
  await enforceOtpIssuanceLimit('merchant_otp_codes', normalized);

  await db
    .delete(merchantOtpCodes)
    .where(and(eq(merchantOtpCodes.email, normalized), lte(merchantOtpCodes.expiresAt, now)));

  await db.insert(merchantOtpCodes).values({
    email: normalized,
    codeHash: hashOtp(code),
    expiresAt,
  });
}

export async function verifyOtp(email: string, code: string): Promise<boolean> {
  return (await verifyOtpCode('merchant_otp_codes', email, code)) !== null;
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.log(`\n[Merchant OTP] Code for ${email}: \x1b[33m${code}\x1b[0m\n`);
    return;
  }

  const { createTransport } = await import('nodemailer');
  const transport = createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });

  const from = process.env.MERCHANT_SMTP_FROM ?? `nTZS Biashara <${user}>`;

  await transport.sendMail({
    from,
    to: email,
    subject: `Your merchant sign-in code: ${code}`,
    html: `
      <div style="font-family:system-ui,sans-serif;background:#000;color:#fff;padding:40px;max-width:480px;margin:0 auto;border-radius:12px;">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.2em;color:#52525b;margin-bottom:24px;">nTZS Merchant</p>
        <h1 style="font-size:32px;font-weight:300;margin:0 0 8px;">Your sign-in code</h1>
        <p style="color:#a1a1aa;font-size:14px;margin-bottom:32px;">Enter this code to access your merchant dashboard. It expires in 10 minutes.</p>
        <div style="font-size:40px;font-weight:700;letter-spacing:0.15em;color:#4ade80;margin-bottom:32px;">${code}</div>
        <p style="color:#52525b;font-size:12px;">If you did not request this code, please ignore this email.</p>
      </div>
    `,
  });
}
