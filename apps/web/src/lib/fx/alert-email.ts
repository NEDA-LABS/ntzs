import { createTransport } from 'nodemailer'

// Ops recipients for SimpleFX LP pool-health alerts.
export const POOL_ALERT_RECIPIENTS = [
  'victor@nedapay.xyz',
  'machuche@nedapay.xyz',
  'devops@nedapay.xyz',
]

/**
 * Send an ops alert email over the SAME SMTP transport as the SimpleFX OTP mailer
 * (SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM). No-ops
 * with a console warning when SMTP isn't configured (e.g. local dev) so callers
 * never throw on a missing mailer.
 */
export async function sendPoolAlertEmail(subject: string, html: string): Promise<void> {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    console.warn(`[fx-pool-reconcile] SMTP not configured — alert not emailed: ${subject}`)
    return
  }

  const transport = createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  })

  const from = process.env.SMTP_FROM ?? `SimpleFX Alerts <${user}>`

  await transport.sendMail({
    from,
    to: POOL_ALERT_RECIPIENTS.join(', '),
    subject,
    html,
  })
}
