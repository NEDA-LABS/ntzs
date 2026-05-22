import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseInviteTokens, partners } from '@ntzs/db'
import { eq, and, isNull } from 'drizzle-orm'
import { requireAnyRole } from '@/lib/auth/rbac'
import { generateInviteToken } from '@/lib/enterprise/auth'
import { sendInviteEmail } from '@/lib/enterprise/otp'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAnyRole(['super_admin', 'platform_compliance']) } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json() as { partnerId?: string }

  const [account] = await db
    .select()
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, id))
    .limit(1)

  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  if (account.isActive) return NextResponse.json({ error: 'Account already active' }, { status: 409 })

  if (body.partnerId) {
    const [partner] = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.id, body.partnerId))
      .limit(1)
    if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

    await db
      .update(enterpriseAccounts)
      .set({ partnerId: body.partnerId, updatedAt: new Date() })
      .where(eq(enterpriseAccounts.id, id))
  }

  // Invalidate any existing unused invite tokens for this account
  await db
    .update(enterpriseInviteTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(enterpriseInviteTokens.enterpriseId, id), isNull(enterpriseInviteTokens.usedAt)))

  const { raw, hash } = generateInviteToken()
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)

  await db.insert(enterpriseInviteTokens).values({
    enterpriseId: id,
    tokenHash: hash,
    expiresAt,
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ntzs.co.tz'
  const inviteUrl = `${appUrl}/enterprise/invite?token=${raw}`

  await sendInviteEmail(account.email, account.name ?? account.email, inviteUrl)

  return NextResponse.json({ ok: true, inviteUrl })
}
