import { createHash, randomInt } from 'crypto';
import { db } from './db';
import { lpOtpCodes } from '@ntzs/db';
import { and, eq, gt, lte } from 'drizzle-orm';

export function generateOtp(): string {
  return String(randomInt(100000, 999999));
}

export function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export async function storeOtp(email: string, code: string): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 min
  const normalized = email.toLowerCase();

  // Clean up expired or used codes for this email first
  await db
    .delete(lpOtpCodes)
    .where(
      and(
        eq(lpOtpCodes.email, normalized),
        lte(lpOtpCodes.expiresAt, now)
      )
    );

  await db.insert(lpOtpCodes).values({
    email: normalized,
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
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter(k => !process.env[k]);
    console.log(`\n[SimpleFX OTP] ${email} → ${code}  (SMTP not configured: ${missing.join(', ')})\n`);
    return;
  }

  const { createTransport } = await import('nodemailer');
  const transport = createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });

  const from = process.env.SMTP_FROM ?? `SimpleFX <${user}>`;

  await transport.sendMail({
    from,
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
