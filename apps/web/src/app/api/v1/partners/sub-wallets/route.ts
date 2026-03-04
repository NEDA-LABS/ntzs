import crypto from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { partners, partnerSubWallets } from '@ntzs/db'
import { deriveSubWalletAddress } from '@/lib/waas/hd-wallets'

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
 * POST /api/v1/partners/sub-wallets
 * Create a new partner sub-wallet (e.g. Escrow, Reserves, Settlement).
 * Derives from the treasury HD path m/44'/8453'/1'/0/{index} at index 1+.
 * Index 0 is always the main treasury wallet.
 *
 * Auth: partner session cookie.
 * Body: { label: string }
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

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: { label: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { label } = body
  if (!label || !label.trim()) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 })
  }
  if (label.trim().length > 50) {
    return NextResponse.json({ error: 'label must be 50 characters or fewer' }, { status: 400 })
  }

  const { db } = getDb()

  // ── Fetch partner ───────────────────────────────────────────────────────────
  const [partner] = await db
    .select({
      id: partners.id,
      encryptedHdSeed: partners.encryptedHdSeed,
      nextSubWalletIndex: partners.nextSubWalletIndex,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)

  if (!partner) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  }
  if (!partner.encryptedHdSeed) {
    return NextResponse.json(
      { error: 'HD wallet seed not configured. Create a user wallet first.' },
      { status: 400 }
    )
  }

  // ── Claim next sub-wallet index atomically ──────────────────────────────────
  const [indexResult] = await db
    .update(partners)
    .set({
      nextSubWalletIndex: sql`${partners.nextSubWalletIndex} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(partners.id, partnerId))
    .returning({ walletIndex: partners.nextSubWalletIndex })

  // nextSubWalletIndex was incremented; assigned index is (new value - 1)
  const walletIndex = (indexResult?.walletIndex ?? 2) - 1

  // ── Derive address ──────────────────────────────────────────────────────────
  const address = deriveSubWalletAddress(partner.encryptedHdSeed, walletIndex)

  // ── Persist sub-wallet record ───────────────────────────────────────────────
  const [subWallet] = await db
    .insert(partnerSubWallets)
    .values({
      partnerId,
      label: label.trim(),
      address,
      walletIndex,
    })
    .returning({
      id: partnerSubWallets.id,
      label: partnerSubWallets.label,
      address: partnerSubWallets.address,
      walletIndex: partnerSubWallets.walletIndex,
      createdAt: partnerSubWallets.createdAt,
    })

  if (!subWallet) {
    return NextResponse.json({ error: 'Failed to create sub-wallet' }, { status: 500 })
  }

  return NextResponse.json(
    {
      id: subWallet.id,
      label: subWallet.label,
      address: subWallet.address,
      walletIndex: subWallet.walletIndex,
      derivationPath: `m/44'/8453'/1'/0/${walletIndex}`,
      createdAt: subWallet.createdAt,
    },
    { status: 201 }
  )
}

/**
 * GET /api/v1/partners/sub-wallets
 * List all sub-wallets for the authenticated partner.
 */
export async function GET(request: NextRequest) {
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

  const { db } = getDb()

  const rows = await db
    .select({
      id: partnerSubWallets.id,
      label: partnerSubWallets.label,
      address: partnerSubWallets.address,
      walletIndex: partnerSubWallets.walletIndex,
      createdAt: partnerSubWallets.createdAt,
    })
    .from(partnerSubWallets)
    .where(eq(partnerSubWallets.partnerId, partnerId))
    .orderBy(partnerSubWallets.walletIndex)

  return NextResponse.json({ subWallets: rows })
}
