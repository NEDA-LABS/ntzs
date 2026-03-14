import crypto from 'crypto'
import { eq, and, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL } from '@/lib/env'
import { generatePartnerSeed, deriveAddress, fundWalletWithGas } from '@/lib/waas/hd-wallets'
import { users, wallets, partnerUsers, partners } from '@ntzs/db'

function verifySessionToken(token: string): string | null {
  const secret = process.env.APP_SECRET || 'dev-secret-do-not-use'
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encoded, sig] = parts
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded!).digest('base64url')

  if (sig!.length !== expectedSig.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig!, 'utf8'), Buffer.from(expectedSig, 'utf8'))) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'))
    if (payload.exp && payload.exp < Date.now()) return null
    return payload.pid || null
  } catch {
    return null
  }
}

/**
 * POST /api/v1/partners/users — Create a user wallet from the partner dashboard.
 * Auth: partner session cookie (same as dashboard).
 * Body: { externalId: string; email: string; name?: string; phone?: string }
 */
export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const cookieToken = request.cookies.get('partner_session')?.value
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = cookieToken || bearerToken

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const partnerId = verifySessionToken(token)
  if (!partnerId) {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })
  }

  if (!process.env.WAAS_ENCRYPTION_KEY) {
    return NextResponse.json({ error: 'Server configuration error: wallet encryption key not set' }, { status: 500 })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: { externalId: string; email: string; name?: string; phone?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { externalId, email, name, phone } = body

  if (!externalId || !email) {
    return NextResponse.json({ error: 'externalId and email are required' }, { status: 400 })
  }

  const { db } = getDb()

  // ── Fetch partner ───────────────────────────────────────────────────────────
  const [partner] = await db
    .select({
      id: partners.id,
      encryptedHdSeed: partners.encryptedHdSeed,
      nextWalletIndex: partners.nextWalletIndex,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)

  if (!partner) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  }

  // ── Idempotency: check existing mapping ────────────────────────────────────
  const [existing] = await db
    .select({ userId: partnerUsers.userId, externalId: partnerUsers.externalId })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partnerId), eq(partnerUsers.externalId, externalId)))
    .limit(1)

  if (existing) {
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, phone: users.phone })
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
      name: user?.name || null,
      phone: user?.phone,
      walletAddress: wallet?.address || null,
      alreadyExists: true,
    })
  }

  // ── Create user ─────────────────────────────────────────────────────────────
  const neonAuthUserId = `waas_${partnerId}_${externalId}`

  const [newUser] = await db
    .insert(users)
    .values({ neonAuthUserId, email, name: name || null, phone: phone || null, role: 'end_user' })
    .onConflictDoNothing()
    .returning({ id: users.id, email: users.email, name: users.name, phone: users.phone })

  let userId: string
  let userEmail: string
  let userName: string | null
  let userPhone: string | null

  if (newUser) {
    userId = newUser.id
    userEmail = newUser.email
    userName = newUser.name
    userPhone = newUser.phone
  } else {
    const [byAuthId] = await db
      .select({ id: users.id, email: users.email, name: users.name, phone: users.phone })
      .from(users)
      .where(eq(users.neonAuthUserId, neonAuthUserId))
      .limit(1)

    if (!byAuthId) {
      return NextResponse.json({ error: 'Failed to create or resolve partner-scoped user' }, { status: 500 })
    }
    userId = byAuthId.id
    userEmail = byAuthId.email
    userName = byAuthId.name
    userPhone = byAuthId.phone
  }

  // ── Ensure partner has HD seed ──────────────────────────────────────────────
  let encryptedSeed = partner.encryptedHdSeed
  if (!encryptedSeed) {
    const { encryptedSeed: newSeed } = generatePartnerSeed()
    await db
      .update(partners)
      .set({ encryptedHdSeed: newSeed, updatedAt: new Date() })
      .where(eq(partners.id, partnerId))
    encryptedSeed = newSeed
  }

  // ── Claim wallet index atomically ───────────────────────────────────────────
  const [indexResult] = await db
    .update(partners)
    .set({ nextWalletIndex: sql`${partners.nextWalletIndex} + 1`, updatedAt: new Date() })
    .where(eq(partners.id, partnerId))
    .returning({ walletIndex: partners.nextWalletIndex })

  const walletIndex = (indexResult?.walletIndex ?? 1) - 1
  const walletAddress = deriveAddress(encryptedSeed, walletIndex)

  // ── Create partner_users mapping ────────────────────────────────────────────
  await db
    .insert(partnerUsers)
    .values({ partnerId, userId, externalId, walletIndex })
    .onConflictDoNothing()

  // ── Provision wallet record ─────────────────────────────────────────────────
  let [wallet] = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
    .limit(1)

  if (!wallet) {
    const [newWallet] = await db
      .insert(wallets)
      .values({ userId, chain: 'base', address: walletAddress, provider: 'external' })
      .returning({ id: wallets.id, address: wallets.address })

    wallet = newWallet

    const rpcUrl = BASE_RPC_URL
    if (rpcUrl && walletAddress) {
      fundWalletWithGas({ toAddress: walletAddress, rpcUrl }).catch((err) =>
        console.error('[partners/users] Gas prefund failed for', walletAddress, err?.message)
      )
    }
  }

  return NextResponse.json(
    {
      id: userId,
      externalId,
      email: userEmail,
      name: userName,
      phone: userPhone,
      walletAddress: wallet?.address || null,
    },
    { status: 201 }
  )
}
