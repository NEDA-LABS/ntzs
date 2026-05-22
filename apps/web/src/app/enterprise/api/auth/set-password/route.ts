import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseInviteTokens } from '@ntzs/db'
import { eq, and, gt, isNull } from 'drizzle-orm'
import { hashInviteToken, hashPassword, createSession, setSessionCookie } from '@/lib/enterprise/auth'

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json()
    if (!token || !password) {
      return NextResponse.json({ error: 'token and password required' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const tokenHash = hashInviteToken(token)

    const [invite] = await db
      .select()
      .from(enterpriseInviteTokens)
      .where(
        and(
          eq(enterpriseInviteTokens.tokenHash, tokenHash),
          isNull(enterpriseInviteTokens.usedAt),
          gt(enterpriseInviteTokens.expiresAt, new Date())
        )
      )
      .limit(1)

    if (!invite) {
      return NextResponse.json({ error: 'Invalid or expired invite link' }, { status: 401 })
    }

    const passwordHash = await hashPassword(password)

    await db
      .update(enterpriseAccounts)
      .set({ passwordHash, isActive: true, updatedAt: new Date() })
      .where(eq(enterpriseAccounts.id, invite.enterpriseId))

    await db
      .update(enterpriseInviteTokens)
      .set({ usedAt: new Date() })
      .where(eq(enterpriseInviteTokens.id, invite.id))

    const token_ = await createSession(invite.enterpriseId)
    await setSessionCookie(token_)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[enterprise/set-password]', err)
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 })
  }
}
