import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { sendEmail, GAS_ALERT_RECIPIENTS } from '@/lib/email'

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, type } = await req.json()

    if (!name || !email || !type) {
      return NextResponse.json({ error: 'name, email, and type required' }, { status: 400 })
    }
    if (!['capital_lender', 'disbursement_client'].includes(type)) {
      return NextResponse.json({ error: 'Invalid account type' }, { status: 400 })
    }

    const normalized = email.toLowerCase().trim()

    const [existing] = await db
      .select({ id: enterpriseAccounts.id })
      .from(enterpriseAccounts)
      .where(eq(enterpriseAccounts.email, normalized))
      .limit(1)

    if (existing) {
      // Don't leak whether account exists — same response either way
      return NextResponse.json({ ok: true })
    }

    await db.insert(enterpriseAccounts).values({
      name: name.trim(),
      email: normalized,
      phone: phone?.trim() ?? null,
      type,
      isActive: false,
    })

    const typeLabel = type === 'capital_lender' ? 'Capital Lender' : 'Disbursement Client'

    await sendEmail({
      to: GAS_ALERT_RECIPIENTS,
      subject: `[NEDApay Enterprise] New signup: ${name} (${typeLabel})`,
      html: `
        <div style="font-family:system-ui,sans-serif;padding:24px;background:#0f172a;color:#f1f5f9;border-radius:8px;max-width:480px;">
          <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.2em;color:#475569;margin-bottom:16px;">NEDApay Enterprise</p>
          <h2 style="margin:0 0 16px;font-size:20px;">New enterprise signup request</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="color:#94a3b8;padding:6px 0;">Organisation</td><td style="padding:6px 0;">${name}</td></tr>
            <tr><td style="color:#94a3b8;padding:6px 0;">Email</td><td style="padding:6px 0;">${normalized}</td></tr>
            <tr><td style="color:#94a3b8;padding:6px 0;">Phone</td><td style="padding:6px 0;">${phone ?? '—'}</td></tr>
            <tr><td style="color:#94a3b8;padding:6px 0;">Type</td><td style="padding:6px 0;color:#6366f1;font-weight:600;">${typeLabel}</td></tr>
          </table>
          <p style="margin-top:24px;font-size:13px;color:#94a3b8;">Review and approve in the <a href="${process.env.NEXT_PUBLIC_APP_URL}/backstage/enterprise" style="color:#6366f1;">backstage enterprise panel</a>.</p>
        </div>
      `,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[enterprise/signup]', err)
    return NextResponse.json({ error: 'Signup failed' }, { status: 500 })
  }
}
