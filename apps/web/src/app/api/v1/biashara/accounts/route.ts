import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/merchant/db'
import { merchantAccounts, users } from '@ntzs/db'
import { requireServiceKey } from '@/lib/service-auth'
import { provisionMerchantWallet, slugFromEmail } from '@/lib/merchant/wallet'

/**
 * POST /api/v1/biashara/accounts
 *
 * Called by NEDApay during Biashara merchant activation.
 * Creates a merchant_accounts row, provisions a merchant wallet,
 * and links the account to the NEDApay user's nTZS WaaS identity.
 *
 * Auth: x-service-key header
 * Body: {
 *   userId: string          — nTZS users.id (from WaaS provisioning)
 *   email: string
 *   businessName?: string
 *   handle?: string         — auto-derived from email if omitted
 *   settlementPhone?: string
 * }
 */
export async function POST(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  let body: {
    userId: string
    email: string
    businessName?: string
    handle?: string
    settlementPhone?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { userId, email, businessName, handle: rawHandle, settlementPhone } = body
  if (!userId || !email) {
    return NextResponse.json({ error: 'userId and email are required' }, { status: 400 })
  }

  const normalized = email.toLowerCase().trim()

  // Verify the nTZS user exists
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) {
    return NextResponse.json({ error: 'User not found — provision via WaaS first' }, { status: 404 })
  }

  // Idempotency: return existing merchant account for this user
  const [existing] = await db
    .select({
      id: merchantAccounts.id,
      handle: merchantAccounts.handle,
      walletAddress: merchantAccounts.walletAddress,
      businessName: merchantAccounts.businessName,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.userId, userId))
    .limit(1)

  if (existing) {
    return NextResponse.json({
      merchantId: existing.id,
      handle: existing.handle,
      walletAddress: existing.walletAddress,
      businessName: existing.businessName,
      alreadyExists: true,
    })
  }

  // Provision merchant wallet
  const { address, index } = await provisionMerchantWallet()

  // Derive handle: prefer caller-supplied, else slug from email, else fallback
  let handle = rawHandle?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || slugFromEmail(normalized) || `merchant${index}`
  const [handleConflict] = await db
    .select({ id: merchantAccounts.id })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.handle, handle))
    .limit(1)
  if (handleConflict) handle = `${handle}${index}`

  const [merchant] = await db
    .insert(merchantAccounts)
    .values({
      email: normalized,
      businessName: businessName?.trim() || null,
      handle,
      walletAddress: address,
      walletIndex: index,
      settlementPhone: settlementPhone?.trim() || null,
      userId,
      onboardingStep: 1,
      isActive: true,
    })
    .returning({
      id: merchantAccounts.id,
      handle: merchantAccounts.handle,
      walletAddress: merchantAccounts.walletAddress,
      businessName: merchantAccounts.businessName,
    })

  return NextResponse.json(
    {
      merchantId: merchant.id,
      handle: merchant.handle,
      walletAddress: merchant.walletAddress,
      businessName: merchant.businessName,
    },
    { status: 201 },
  )
}
