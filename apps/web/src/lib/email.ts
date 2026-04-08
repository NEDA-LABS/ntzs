import nodemailer from 'nodemailer'

export const GAS_ALERT_RECIPIENTS = [
  'victor@ntzs.co.tz',
  'machuche@ntzs.co.tz',
  'devops@ntzs.co.tz',
]

function getTransporter() {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!user || !pass) return null

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
}

export async function sendEmail(params: {
  to: string | string[]
  subject: string
  html: string
}) {
  const transporter = getTransporter()
  if (!transporter) {
    console.warn('[email] SMTP_USER or SMTP_PASS not set — skipping email')
    return
  }

  try {
    await transporter.sendMail({
      from: `"nTZS Alerts" <${process.env.SMTP_USER}>`,
      to: Array.isArray(params.to) ? params.to.join(', ') : params.to,
      subject: params.subject,
      html: params.html,
    })
    console.log('[email] Sent:', params.subject)
  } catch (err) {
    console.error('[email] Failed to send:', err instanceof Error ? err.message : err)
  }
}
