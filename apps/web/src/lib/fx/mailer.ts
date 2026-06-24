import { createTransport } from 'nodemailer'

/**
 * Send a SimpleFX / bank-partner email over the same SMTP transport as the OTP
 * mailer (SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM) —
 * the transport that's proven to deliver to partners. No-ops with a warning when
 * SMTP isn't configured, so callers never throw on a missing mailer.
 */
export async function sendFxMail(to: string | string[], subject: string, html: string): Promise<void> {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    console.warn(`[fx-mail] SMTP not configured — not sent: ${subject}`)
    return
  }

  const transport = createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  })

  const from = process.env.SMTP_FROM ?? `SimpleFX <${user}>`
  await transport.sendMail({
    from,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
  })
}

/** Branded shell for SimpleFX transactional emails. */
export function fxEmailShell(heading: string, bodyHtml: string): string {
  return `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
    <div style="padding:20px 0;border-bottom:1px solid #e5e7eb">
      <span style="font-weight:700;font-size:16px;color:#0f172a">Simple<span style="color:#2563eb">FX</span></span>
    </div>
    <div style="padding:24px 0">
      <h2 style="margin:0 0 12px;font-size:18px;color:#0f172a">${heading}</h2>
      ${bodyHtml}
    </div>
    <div style="padding:16px 0;border-top:1px solid #e5e7eb;color:#64748b;font-size:12px">
      NEDA LABS · SimpleFX liquidity partner onboarding
    </div>
  </div>`
}
