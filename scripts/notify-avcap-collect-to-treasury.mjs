/**
 * One-time notification — AVCAP Terminal treasury collection fix
 *
 * Usage:
 *   node --env-file=.env.local scripts/notify-avcap-collect-to-treasury.mjs
 *
 * Requires:
 *   SMTP_USER  — Gmail address used to send
 *   SMTP_PASS  — Gmail app password
 */

import 'dotenv/config'
import nodemailer from 'nodemailer'

function getTransporter() {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!user || !pass) throw new Error('SMTP_USER and SMTP_PASS must be set')
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
}

function buildHtml() {
  return `
    <div style="background:#09090b;padding:32px;font-family:system-ui,sans-serif;max-width:620px;margin:0 auto;border-radius:12px">

      <div style="margin-bottom:28px">
        <p style="color:#71717a;margin:0 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.08em">nTZS Developer Platform</p>
        <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0">Fix: collected payments now land in your treasury</h1>
      </div>

      <p style="color:#a1a1aa;font-size:15px;line-height:1.6;margin:0 0 20px">
        Hi AVCAP Terminal,
      </p>

      <p style="color:#a1a1aa;font-size:15px;line-height:1.6;margin:0 0 20px">
        We investigated the issue you reported where collected payments were landing in per-user wallets
        instead of your treasury. We have identified the cause and deployed a fix.
      </p>

      <div style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:20px;margin-bottom:24px">
        <p style="color:#ffffff;font-weight:600;font-size:14px;margin:0 0 10px">What was happening</p>
        <p style="color:#71717a;font-size:13px;line-height:1.6;margin:0">
          The <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">POST /api/v1/deposits</code>
          endpoint was designed for wallet-as-a-service use cases, where each deposit mints nTZS directly into
          the individual user's wallet. Since AVCAP is collecting payments on behalf of your platform rather
          than crediting end-user wallets, the funds were going to the wrong destination.
        </p>
      </div>

      <div style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:20px;margin-bottom:24px">
        <p style="color:#ffffff;font-weight:600;font-size:14px;margin:0 0 14px">The fix — one field added to your existing request</p>
        <p style="color:#71717a;font-size:13px;margin:0 0 14px">
          Add <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">"collectToTreasury": true</code>
          to your deposit requests. The collected nTZS will be minted directly into your treasury wallet instead of the user's wallet.
        </p>
        <pre style="background:#09090b;border:1px solid #27272a;border-radius:6px;padding:14px;font-size:12px;color:#86efac;overflow-x:auto;margin:0">{
  "userId": "your-customer-id",
  "amountTzs": 50000,
  "phoneNumber": "255712345678",
  "collectToTreasury": true
}</pre>
      </div>

      <div style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:20px;margin-bottom:24px">
        <p style="color:#ffffff;font-weight:600;font-size:14px;margin:0 0 10px">Prerequisites</p>
        <ul style="color:#71717a;font-size:13px;line-height:1.8;margin:0;padding-left:18px">
          <li>Your treasury wallet must be provisioned — check the Treasury section of your partner dashboard.</li>
          <li>
            The <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">userId</code>
            field is still required for audit trail purposes, but the user no longer needs a wallet provisioned.
          </li>
          <li>Works with both <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">mobile_money</code> and <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">card</code> payment methods.</li>
        </ul>
      </div>

      <div style="background:#18181b;border:1px solid #14532d;border-radius:8px;padding:16px;margin-bottom:28px">
        <p style="color:#86efac;font-weight:600;font-size:13px;margin:0 0 6px">No disruption to existing calls</p>
        <p style="color:#71717a;font-size:13px;margin:0;line-height:1.6">
          All existing deposit requests without <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">collectToTreasury</code>
          continue to work exactly as before. This is an additive change only.
        </p>
      </div>

      <div style="border-top:1px solid #27272a;padding-top:20px">
        <p style="color:#52525b;font-size:12px;margin:0 0 6px">
          Full documentation:
          <a href="https://www.ntzs.co.tz/developers" style="color:#3b82f6;text-decoration:none">ntzs.co.tz/developers</a>
        </p>
        <p style="color:#52525b;font-size:12px;margin:0">
          Questions? Reply to this email or reach us at
          <a href="mailto:hello@ntzs.co.tz" style="color:#3b82f6;text-decoration:none">hello@ntzs.co.tz</a>
        </p>
      </div>

    </div>
  `
}

async function main() {
  const to = 'app@avcap.co.tz'
  const transporter = getTransporter()

  await transporter.sendMail({
    from: `"nTZS Developer Platform" <${process.env.SMTP_USER}>`,
    to,
    subject: 'Action required: fix for collected payments not reaching your treasury',
    html: buildHtml(),
  })

  console.log(`Sent to ${to}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
