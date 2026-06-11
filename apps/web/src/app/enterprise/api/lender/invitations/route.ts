import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/enterprise/db'
import {
  enterpriseAccounts,
  merchantAccounts,
  enterpriseMerchantApplications,
} from '@ntzs/db'
import { eq, or, and } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'
import { sendMerchantFinancingInviteEmail } from '@/lib/merchant/notifications'

async function getLenderAccount(enterpriseId: string) {
  const [account] = await db
    .select({ id: enterpriseAccounts.id, name: enterpriseAccounts.name, partnerId: enterpriseAccounts.partnerId, type: enterpriseAccounts.type })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, enterpriseId))
    .limit(1)
  return account
}

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getLenderAccount(session.enterpriseId)
  if (!account?.partnerId || account.type !== 'capital_lender') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await db
    .select({
      id: enterpriseMerchantApplications.id,
      direction: enterpriseMerchantApplications.direction,
      status: enterpriseMerchantApplications.status,
      proposedSplitPct: enterpriseMerchantApplications.proposedSplitPct,
      message: enterpriseMerchantApplications.message,
      respondedAt: enterpriseMerchantApplications.respondedAt,
      createdAt: enterpriseMerchantApplications.createdAt,
      merchantId: merchantAccounts.id,
      merchantName: merchantAccounts.businessName,
      merchantHandle: merchantAccounts.handle,
      merchantEmail: merchantAccounts.email,
    })
    .from(enterpriseMerchantApplications)
    .innerJoin(merchantAccounts, eq(merchantAccounts.id, enterpriseMerchantApplications.merchantId))
    .where(eq(enterpriseMerchantApplications.enterpriseId, session.enterpriseId))
    .orderBy(enterpriseMerchantApplications.createdAt)

  return NextResponse.json({ invitations: rows })
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getLenderAccount(session.enterpriseId)
  if (!account?.partnerId || account.type !== 'capital_lender') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { merchantId, proposedSplitPct, message } = body

  if (!merchantId) return NextResponse.json({ error: 'merchantId required' }, { status: 400 })
  if (typeof proposedSplitPct !== 'number' || proposedSplitPct < 1 || proposedSplitPct > 95) {
    return NextResponse.json({ error: 'proposedSplitPct must be 1–95' }, { status: 400 })
  }

  const [merchant] = await db
    .select({ id: merchantAccounts.id, email: merchantAccounts.email, lenderPartnerId: merchantAccounts.lenderPartnerId })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant) return NextResponse.json({ error: 'Merchant not found' }, { status: 404 })
  if (merchant.lenderPartnerId) {
    return NextResponse.json({ error: 'Merchant is already under a lender' }, { status: 409 })
  }

  // Check no pending record already exists
  const [existing] = await db
    .select({ id: enterpriseMerchantApplications.id })
    .from(enterpriseMerchantApplications)
    .where(
      and(
        eq(enterpriseMerchantApplications.enterpriseId, session.enterpriseId),
        eq(enterpriseMerchantApplications.merchantId, merchantId),
        eq(enterpriseMerchantApplications.status, 'pending')
      )
    )
    .limit(1)

  if (existing) return NextResponse.json({ error: 'A pending invite or application already exists for this merchant' }, { status: 409 })

  const [row] = await db
    .insert(enterpriseMerchantApplications)
    .values({
      enterpriseId: session.enterpriseId,
      merchantId,
      direction: 'invite',
      proposedSplitPct,
      message: message ?? null,
    })
    .returning()

  // Notify the merchant by email (after the response; never fails the invite).
  if (merchant.email) {
    after(() =>
      sendMerchantFinancingInviteEmail({
        to: merchant.email,
        lenderName: account.name,
        proposedSplitPct,
        message: message ?? null,
      }).catch((err) => console.error('[lender/invitations] invite email failed:', err instanceof Error ? err.message : err)),
    )
  }

  return NextResponse.json({ invitation: row }, { status: 201 })
}
