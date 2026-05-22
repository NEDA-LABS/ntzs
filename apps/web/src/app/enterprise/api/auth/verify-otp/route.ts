import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { verifyOtp } from '@/lib/enterprise/otp'
import { createSession, setSessionCookie } from '@/lib/enterprise/auth'

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json()
    if (!email || !code) {
      return NextResponse.json({ error: 'email and code required' }, { status: 400 })
    }

    const normalized = email.toLowerCase().trim()

    const valid = await verifyOtp(normalized, code)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
    }

    const [account] = await db
      .select()
      .from(enterpriseAccounts)
      .where(eq(enterpriseAccounts.email, normalized))
      .limit(1)

    if (!account?.isActive) {
      return NextResponse.json({ error: 'Account not active' }, { status: 403 })
    }

    const token = await createSession(account.id)
    await setSessionCookie(token)

    return NextResponse.json({ ok: true, hasPassword: !!account.passwordHash })
  } catch (err) {
    console.error('[enterprise/verify-otp]', err)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
