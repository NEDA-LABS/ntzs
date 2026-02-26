import { eq, and, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import { generatePartnerSeed, deriveAddress } from '@/lib/waas/hd-wallets'
import { users, wallets, partnerUsers, partners } from '@ntzs/db'

/**
 * POST /api/v1/users — Create a new user and provision an embedded wallet
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult

  let body: { externalId: string; email: string; phone?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { externalId, email, phone } = body

  if (!externalId || !email) {
    return NextResponse.json(
      { error: 'externalId and email are required' },
      { status: 400 }
    )
  }

  const { db } = getDb()

  // Check if this partner+externalId mapping already exists
  const [existing] = await db
    .select({
      userId: partnerUsers.userId,
      externalId: partnerUsers.externalId,
    })
    .from(partnerUsers)
    .where(
      and(
        eq(partnerUsers.partnerId, partner.id),
        eq(partnerUsers.externalId, externalId)
      )
    )
    .limit(1)

  if (existing) {
    // Return existing user
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        phone: users.phone,
      })
      .from(users)
      .where(eq(users.id, existing.userId))
      .limit(1)

    const [wallet] = await db
      .select({ address: wallets.address })
      .from(wallets)
      .where(and(eq(wallets.userId, existing.userId), eq(wallets.chain, 'base')))
      .limit(1)

    return NextResponse.json({
      id: existing.userId,
      externalId: existing.externalId,
      email: user?.email,
      phone: user?.phone,
      walletAddress: wallet?.address || null,
      balance: 0,
    })
  }

  // Create new user
  // Use a generated neonAuthUserId placeholder for WaaS-created users
  const neonAuthUserId = `waas_${partner.id}_${externalId}`

  const [newUser] = await db
    .insert(users)
    .values({
      neonAuthUserId,
      email,
      phone: phone || null,
      role: 'end_user',
    })
    .onConflictDoNothing()
    .returning({ id: users.id, email: users.email, phone: users.phone })

  // If user already exists by email, find them
  let userId: string
  let userEmail: string
  let userPhone: string | null

  if (newUser) {
    userId = newUser.id
    userEmail = newUser.email
    userPhone = newUser.phone
  } else {
    const [existingUser] = await db
      .select({ id: users.id, email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    if (!existingUser) {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
    }
    userId = existingUser.id
    userEmail = existingUser.email
    userPhone = existingUser.phone
  }

  // Ensure partner has an HD seed (auto-generate on first user creation)
  let encryptedSeed = partner.encryptedHdSeed
  if (!encryptedSeed) {
    const { encryptedSeed: newSeed } = generatePartnerSeed()
    await db
      .update(partners)
      .set({ encryptedHdSeed: newSeed, updatedAt: new Date() })
      .where(eq(partners.id, partner.id))
    encryptedSeed = newSeed
    console.log('[v1/users] Generated HD seed for partner:', partner.id)
  }

  // Atomically claim the next wallet index for this user
  const [indexResult] = await db
    .update(partners)
    .set({
      nextWalletIndex: sql`${partners.nextWalletIndex} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(partners.id, partner.id))
    .returning({ walletIndex: partners.nextWalletIndex })

  // nextWalletIndex was incremented, so the assigned index is (new value - 1)
  const walletIndex = (indexResult?.walletIndex ?? 1) - 1

  // Derive the deterministic wallet address instantly
  const walletAddress = deriveAddress(encryptedSeed, walletIndex)

  // Create partner_users mapping with wallet index
  await db
    .insert(partnerUsers)
    .values({
      partnerId: partner.id,
      userId,
      externalId,
      walletIndex,
    })
    .onConflictDoNothing()

  // Check if wallet already exists for this user on Base
  let [wallet] = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
    .limit(1)

  if (!wallet) {
    const [newWallet] = await db
      .insert(wallets)
      .values({
        userId,
        chain: 'base',
        address: walletAddress,
        provider: 'external',
      })
      .returning({ id: wallets.id, address: wallets.address })

    wallet = newWallet
  }

  return NextResponse.json(
    {
      id: userId,
      externalId,
      email: userEmail,
      phone: userPhone,
      walletAddress: wallet?.address || null,
      balance: 0,
    },
    { status: 201 }
  )
}
