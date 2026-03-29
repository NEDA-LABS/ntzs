/**
 * One-time notification script — card payments now available on WaaS API
 *
 * Fetches all active partners with a registered email address and sends
 * them a changelog email about the new card deposit option.
 *
 * Usage:
 *   node --env-file=.env.local scripts/notify-partners-card-payments.mjs
 *
 * Requires:
 *   DATABASE_URL   — Neon Postgres connection string
 *   SMTP_USER      — Gmail address used to send (e.g. devops@ntzs.co.tz)
 *   SMTP_PASS      — Gmail app password
 */

import 'dotenv/config'
import pg from 'pg'
import nodemailer from 'nodemailer'

const { Client } = pg

function getTransporter() {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!user || !pass) throw new Error('SMTP_USER and SMTP_PASS must be set')
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
}

function buildHtml(partnerName) {
  return `
    <div style="background:#09090b;padding:32px;font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;border-radius:12px">

      <div style="margin-bottom:28px">
        <p style="color:#71717a;margin:0 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.08em">nTZS Developer Platform</p>
        <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0">Card payments are now available</h1>
      </div>

      <p style="color:#a1a1aa;font-size:15px;line-height:1.6;margin:0 0 20px">
        Hi${partnerName ? ` ${partnerName}` : ''},
      </p>

      <p style="color:#a1a1aa;font-size:15px;line-height:1.6;margin:0 0 20px">
        Your WaaS integration now supports card payments as a deposit method alongside mobile money.
        No changes are required on your end — your existing integration continues to work exactly as before.
      </p>

      <div style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:20px;margin-bottom:24px">
        <p style="color:#ffffff;font-weight:600;font-size:14px;margin:0 0 14px">What changed — <code style="color:#a78bfa">POST /api/v1/deposits</code></p>
        <p style="color:#71717a;font-size:13px;margin:0 0 12px">
          Pass <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">paymentMethod: "card"</code>
          with <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">redirectUrl</code> and
          <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">cancelUrl</code>.
          The response includes a <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">paymentUrl</code>
          — redirect your user to it to complete payment on a hosted card page.
          Once paid, nTZS is minted to their wallet automatically.
        </p>
        <pre style="background:#09090b;border:1px solid #27272a;border-radius:6px;padding:14px;font-size:12px;color:#86efac;overflow-x:auto;margin:0">{
  "userId": "...",
  "amountTzs": 10000,
  "paymentMethod": "card",
  "redirectUrl": "https://yourapp.com/payment/success",
  "cancelUrl": "https://yourapp.com/payment/cancel"
}</pre>
      </div>

      <div style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:20px;margin-bottom:24px">
        <p style="color:#ffffff;font-weight:600;font-size:14px;margin:0 0 10px">Response</p>
        <pre style="background:#09090b;border:1px solid #27272a;border-radius:6px;padding:14px;font-size:12px;color:#86efac;overflow-x:auto;margin:0">{
  "id": "...",
  "status": "submitted",
  "amountTzs": 10000,
  "paymentMethod": "card",
  "paymentUrl": "https://pay.snippe.sh/..."
}</pre>
      </div>

      <div style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:16px;margin-bottom:28px">
        <p style="color:#ffffff;font-weight:600;font-size:13px;margin:0 0 8px">No action required</p>
        <p style="color:#71717a;font-size:13px;margin:0;line-height:1.6">
          <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">paymentMethod</code> defaults to
          <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">"mobile_money"</code> when omitted.
          Existing calls with <code style="background:#27272a;color:#e2e8f0;padding:2px 6px;border-radius:4px">phoneNumber</code>
          continue to work unchanged.
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
  const dbClient = new Client({ connectionString: process.env.DATABASE_URL })
  await dbClient.connect()

  const { rows: partners } = await dbClient.query(`
    SELECT id, name, email
    FROM partners
    WHERE is_active = true
      AND email IS NOT NULL
    ORDER BY created_at ASC
  `)

  await dbClient.end()

  if (partners.length === 0) {
    console.log('No active partners with email addresses found.')
    return
  }

  console.log(`Sending to ${partners.length} partner(s)...\n`)

  const transporter = getTransporter()
  let sent = 0
  let failed = 0

  for (const partner of partners) {
    try {
      await transporter.sendMail({
        from: `"nTZS Developer Platform" <${process.env.SMTP_USER}>`,
        to: partner.email,
        subject: 'Card payments are now available on the WaaS API',
        html: buildHtml(partner.name),
      })
      console.log(`  sent   ${partner.email} (${partner.name})`)
      sent++
    } catch (err) {
      console.error(`  failed ${partner.email} (${partner.name}) — ${err.message}`)
      failed++
    }

    // Small delay between sends to avoid Gmail rate limits
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\nDone. ${sent} sent, ${failed} failed.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
