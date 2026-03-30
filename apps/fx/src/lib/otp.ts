import { createHash, randomInt } from 'crypto';
import { db } from './db';
import { lpOtpCodes } from '@ntzs/db';
import { and, eq, gt } from 'drizzle-orm';

export function generateOtp(): string {
  return String(randomInt(100000, 999999));
}

export function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export async function storeOtp(email: string, code: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  await db.insert(lpOtpCodes).values({
    email: email.toLowerCase(),
    codeHash: hashOtp(code),
    expiresAt,
  });
}

export async function verifyOtp(email: string, code: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(lpOtpCodes)
    .where(
      and(
        eq(lpOtpCodes.email, email.toLowerCase()),
        eq(lpOtpCodes.codeHash, hashOtp(code)),
        eq(lpOtpCodes.used, false),
        gt(lpOtpCodes.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!rows.length) return false;

  await db
    .update(lpOtpCodes)
    .set({ used: true })
    .where(eq(lpOtpCodes.id, rows[0].id));

  return true;
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');

  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);

  await resend.emails.send({
    from: 'SimpleFX <noreply@nedapay.xyz>',
    to: email,
    subject: `Your SimpleFX sign-in code: ${code}`,
    html: `
      <div style="font-family:system-ui,sans-serif;background:#000;color:#fff;padding:40px;max-width:480px;margin:0 auto;border-radius:12px;">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.2em;color:#52525b;margin-bottom:24px;">SimpleFX</p>
        <h1 style="font-size:32px;font-weight:300;margin:0 0 8px;">Your sign-in code</h1>
        <p style="color:#a1a1aa;font-size:14px;margin-bottom:32px;">Enter this code to access your LP dashboard. It expires in 10 minutes.</p>
        <div style="font-size:40px;font-weight:700;letter-spacing:0.15em;color:#60a5fa;margin-bottom:32px;">${code}</div>
        <p style="color:#52525b;font-size:12px;">If you did not request this code, please ignore this email.</p>
      </div>
    `,
  });
}
