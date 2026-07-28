import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/merchant/db'
import { merchantAccounts, users } from '@ntzs/db'
import { findMerchantForActivation, requireBiasharaCaller, reserveHandle } from '@/lib/biashara/caller'
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
  const authResult = await requireBiasharaCaller(req)
  if ('error' in authResult) return authResult.error
  const { caller } = authResult

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

  // Idempotency: check by userId first, then fall back to email for legacy rows
  // that were created before the user_id column existed (userId = NULL).
  //
  // ⚠ TENANT-CRITICAL. This lookup must be confined to the caller's own book.
  // Unscoped, a partner activating a merchant whose email already exists
  // first-party would be handed back SOMEONE ELSE'S merchantId — every
  // subsequent call would then read and move another tenant's money.
  const existing = await findMerchantForActivation(caller, userId, normalized)

  if (existing) {
    // Backfill userId on legacy rows so future lookups hit the fast path
    if (!existing.userId) {
      await db
        .update(merchantAccounts)
        .set({ userId, updatedAt: new Date() })
        .where(eq(merchantAccounts.id, existing.id))
    }
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

  // Handle is the PUBLIC payment identity (/pay/:alias resolves it with no
  // tenant context), so it stays globally unique — and a collision must never
  // surface as an error: we suffix until one is free and return what was
  // actually assigned.
  const preferred = rawHandle?.trim().toLowerCase() || slugFromEmail(normalized)
  const handle = await reserveHandle(preferred, index)

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
      // Omitted entirely on the service path so the column is never named
      // there — that is what keeps NEDApay working if this deploys ahead of
      // drizzle/0067.
      ...(caller.scope === 'partner' ? { partnerId: caller.partnerId } : {}),
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
