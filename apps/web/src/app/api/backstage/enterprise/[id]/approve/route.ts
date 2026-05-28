import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseInviteTokens, partners, partnerSubWallets } from '@ntzs/db'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { requireAnyRole } from '@/lib/auth/rbac'
import { generateInviteToken } from '@/lib/enterprise/auth'
import { sendInviteEmail } from '@/lib/enterprise/otp'
import { deriveSubWalletAddress } from '@/lib/waas/hd-wallets'

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

  // Link to WaaS partner if provided, then provision an org treasury sub-wallet
  let treasuryWalletAddress: string | null = null

  if (body.partnerId) {
    const [partner] = await db
      .select({
        id: partners.id,
        encryptedHdSeed: partners.encryptedHdSeed,
        nextSubWalletIndex: partners.nextSubWalletIndex,
      })
      .from(partners)
      .where(eq(partners.id, body.partnerId))
      .limit(1)

    if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

    await db
      .update(enterpriseAccounts)
      .set({ partnerId: body.partnerId, updatedAt: new Date() })
      .where(eq(enterpriseAccounts.id, id))

    // Auto-provision org treasury sub-wallet if the partner has an HD seed
    if (partner.encryptedHdSeed) {
      const [indexResult] = await db
        .update(partners)
        .set({ nextSubWalletIndex: sql`${partners.nextSubWalletIndex} + 1`, updatedAt: new Date() })
        .where(eq(partners.id, partner.id))
        .returning({ walletIndex: partners.nextSubWalletIndex })

      const walletIndex = (indexResult?.walletIndex ?? 2) - 1
      treasuryWalletAddress = deriveSubWalletAddress(partner.encryptedHdSeed, walletIndex)

      await db.insert(partnerSubWallets).values({
        partnerId: partner.id,
        label: `org-treasury:${id}`,
        address: treasuryWalletAddress,
        walletIndex,
      })
    }
  }

  // Activate the account
  await db
    .update(enterpriseAccounts)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(enterpriseAccounts.id, id))

  // For NEDApay-submitted orgs: fire webhook so NEDApay can update productAccess
  if (account.linkedAdminUserId) {
    const webhookUrl = process.env.NEDAPAY_WEBHOOK_URL
    if (webhookUrl) {
      fetch(`${webhookUrl}/api/v1/webhooks/ntzs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'enterprise.approved',
          enterpriseId: id,
          linkedAdminUserId: account.linkedAdminUserId,
          orgName: account.name,
          orgType: account.type,
          treasuryWalletAddress,
        }),
      }).catch((err) =>
        console.error('[backstage/enterprise/approve] Webhook delivery failed:', err?.message),
      )
    }
  }

  // For legacy portal orgs (no linkedAdminUserId): send the invite email as before
  if (!account.linkedAdminUserId) {
    await db
      .update(enterpriseInviteTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(enterpriseInviteTokens.enterpriseId, id), isNull(enterpriseInviteTokens.usedAt)))

    const { raw, hash } = generateInviteToken()
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)

    await db.insert(enterpriseInviteTokens).values({ enterpriseId: id, tokenHash: hash, expiresAt })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ntzs.co.tz'
    const inviteUrl = `${appUrl}/enterprise/invite?token=${raw}`

    await sendInviteEmail(account.email, account.name ?? account.email, inviteUrl)

    return NextResponse.json({ ok: true, inviteUrl })
  }

  return NextResponse.json({ ok: true, treasuryWalletAddress })
}
