import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { generateOtp, storeOtp, sendOtpEmail } from '@/lib/enterprise/otp'
import { OtpRateLimitError } from '@/lib/auth/otp-core'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'email required' }, { status: 400 })
    }

    const normalized = email.toLowerCase().trim()

    const [account] = await db
      .select({ id: enterpriseAccounts.id, isActive: enterpriseAccounts.isActive })
      .from(enterpriseAccounts)
      .where(eq(enterpriseAccounts.email, normalized))
      .limit(1)

    if (!account?.isActive) {
      // Constant-time response — don't reveal if account exists or is pending
      await new Promise(r => setTimeout(r, 150))
      return NextResponse.json({ ok: true })
    }

    const code = generateOtp()
    await storeOtp(normalized, code)
    await sendOtpEmail(normalized, code)

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    console.error('[enterprise/request-otp]', err)
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }
}
