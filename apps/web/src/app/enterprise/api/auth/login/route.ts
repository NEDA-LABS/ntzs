import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { verifyPassword, createSession, setSessionCookie } from '@/lib/enterprise/auth'

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }

    const normalized = email.toLowerCase().trim()

    const [account] = await db
      .select()
      .from(enterpriseAccounts)
      .where(eq(enterpriseAccounts.email, normalized))
      .limit(1)

    if (!account?.isActive || !account.passwordHash) {
      await new Promise(r => setTimeout(r, 200))
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await verifyPassword(password, account.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = await createSession(account.id)
    await setSessionCookie(token)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[enterprise/login]', err)
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
