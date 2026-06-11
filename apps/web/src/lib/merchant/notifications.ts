/**
 * Merchant-facing email notifications.
 *
 * Mirrors the SMTP setup used by the merchant OTP emails (SMTP_HOST/USER/PASS;
 * falls back to a console log in dev when SMTP isn't configured).
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ntzs.co.tz'

/**
 * Notify a merchant that a capital lender has invited them to a financing
 * programme. The invite is accepted from the merchant dashboard
 * (Settings → Financing), so the CTA deep-links there.
 */
export async function sendMerchantFinancingInviteEmail(opts: {
  to: string
  lenderName: string
  proposedSplitPct: number
  message?: string | null
}): Promise<void> {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  const settingsUrl = `${APP_URL}/merchant/dashboard/settings`

  if (!host || !user || !pass) {
    console.log(
      `\n[Merchant Invite] ${opts.lenderName} invited ${opts.to} ` +
      `(split ${opts.proposedSplitPct}%) → ${settingsUrl}\n`,
    )
    return
  }

  const { createTransport } = await import('nodemailer')
  const transport = createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  })

  const from = process.env.MERCHANT_SMTP_FROM ?? `nTZS Biashara <${user}>`

  const messageBlock = opts.message
    ? `<p style="color:#a1a1aa;font-size:13px;line-height:1.6;margin:0 0 24px;border-left:2px solid #4ade80;padding-left:12px;">${escapeHtml(opts.message)}</p>`
    : ''

  await transport.sendMail({
    from,
    to: opts.to,
    subject: `${opts.lenderName} invited you to their financing programme`,
    html: `
      <div style="font-family:system-ui,sans-serif;background:#000;color:#fff;padding:40px;max-width:480px;margin:0 auto;border-radius:12px;">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.2em;color:#52525b;margin-bottom:24px;">nTZS Biashara · Financing</p>
        <h1 style="font-size:26px;font-weight:300;margin:0 0 12px;">${escapeHtml(opts.lenderName)} wants to fund your business</h1>
        <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 20px;">
          They've invited you to their financing programme, proposing a
          <strong style="color:#4ade80;">${opts.proposedSplitPct}%</strong> repayment split on each collection.
        </p>
        ${messageBlock}
        <a href="${settingsUrl}" style="display:inline-block;background:#4ade80;color:#000;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:14px;font-weight:600;margin:8px 0 28px;">Review &amp; respond</a>
        <p style="color:#52525b;font-size:12px;line-height:1.5;">
          Sign in to your merchant dashboard and open <strong>Settings → Financing</strong> to accept or decline.
          If you didn't expect this, you can safely ignore it.
        </p>
      </div>
    `,
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
