import { randomInt } from 'crypto'
import { db } from './db'
import { enterpriseOtpCodes } from '@ntzs/db'
import { and, eq, lte } from 'drizzle-orm'
import { enforceOtpIssuanceLimit, hashOtp, verifyOtpCode } from '@/lib/auth/otp-core'

export function generateOtp(): string {
  return String(randomInt(100000, 999999))
}

export async function storeOtp(email: string, code: string): Promise<void> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
  const normalized = email.toLowerCase()

  // Throttle issuance before minting a new code (anti brute-force / anti-bomb).
  await enforceOtpIssuanceLimit('enterprise_otp_codes', normalized)

  await db
    .delete(enterpriseOtpCodes)
    .where(and(eq(enterpriseOtpCodes.email, normalized), lte(enterpriseOtpCodes.expiresAt, now)))

  await db.insert(enterpriseOtpCodes).values({
    email: normalized,
    codeHash: hashOtp(code),
    expiresAt,
  })
}

export async function verifyOtp(email: string, code: string): Promise<boolean> {
  return (await verifyOtpCode('enterprise_otp_codes', email, code)) !== null
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host && !user) {
    console.log(`\n[Enterprise OTP] Code for ${email}: \x1b[36m${code}\x1b[0m\n`)
    return
  }

  const { createTransport } = await import('nodemailer')
  const transport = createTransport({
    service: 'gmail',
    auth: { user, pass },
  })

  await transport.sendMail({
    from: `"NEDApay Enterprise" <${user}>`,
    to: email,
    subject: `Your NEDApay Enterprise sign-in code: ${code}`,
    html: `
      <div style="font-family:system-ui,sans-serif;background:#0f172a;color:#f1f5f9;padding:40px;max-width:480px;margin:0 auto;border-radius:12px;">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.2em;color:#475569;margin-bottom:24px;">NEDApay Enterprise</p>
        <h1 style="font-size:32px;font-weight:300;margin:0 0 8px;">Your sign-in code</h1>
        <p style="color:#94a3b8;font-size:14px;margin-bottom:32px;">Enter this code to access your Enterprise dashboard. It expires in 10 minutes.</p>
        <div style="font-size:40px;font-weight:700;letter-spacing:0.15em;color:#6366f1;margin-bottom:32px;">${code}</div>
        <p style="color:#475569;font-size:12px;">If you did not request this code, please ignore this email.</p>
      </div>
    `,
  })
}

export async function sendInviteEmail(email: string, orgName: string, inviteUrl: string): Promise<void> {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!user) {
    console.log(`\n[Enterprise Invite] URL for ${email}: \x1b[36m${inviteUrl}\x1b[0m\n`)
    return
  }

  const { createTransport } = await import('nodemailer')
  const transport = createTransport({
    service: 'gmail',
    auth: { user, pass },
  })

  await transport.sendMail({
    from: `"NEDApay Enterprise" <${user}>`,
    to: email,
    subject: `Your NEDApay Enterprise account is ready`,
    html: `
      <div style="font-family:system-ui,sans-serif;background:#0f172a;color:#f1f5f9;padding:40px;max-width:480px;margin:0 auto;border-radius:12px;">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.2em;color:#475569;margin-bottom:24px;">NEDApay Enterprise</p>
        <h1 style="font-size:28px;font-weight:300;margin:0 0 8px;">Welcome, ${orgName}</h1>
        <p style="color:#94a3b8;font-size:14px;margin-bottom:32px;">Your enterprise account has been approved. Click below to set your password and access your dashboard.</p>
        <a href="${inviteUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:14px;font-weight:600;margin-bottom:32px;">Set Password &amp; Sign In</a>
        <p style="color:#475569;font-size:12px;">This link expires in 48 hours. If you did not request this, please contact support.</p>
      </div>
    `,
  })
}
