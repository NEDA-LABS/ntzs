import crypto from 'crypto'
import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { partners, partnerUsers, wallets } from '@ntzs/db'

function verifySessionToken(token: string): string | null {
  const secret = process.env.APP_SECRET || 'dev-secret-do-not-use'
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [encoded, sig] = parts
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded!).digest('base64url')
  if (sig!.length !== expectedSig.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig!, 'utf8'), Buffer.from(expectedSig, 'utf8'))) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'))
    if (payload.exp && payload.exp < Date.now()) return null
    return payload.pid || null
  } catch {
    return null
  }
}

/**
 * PATCH /api/v1/partners/wallets/freeze
 * Toggle frozen status on a user wallet owned by this partner.
 * Body: { walletId: string; frozen: boolean }
 */
export async function PATCH(request: NextRequest) {
  const cookieToken = request.cookies.get('partner_session')?.value
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = cookieToken || bearerToken

  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const partnerId = verifySessionToken(token)
  if (!partnerId) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })

  let body: { walletId: string; frozen: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { walletId, frozen } = body
  if (!walletId || typeof frozen !== 'boolean') {
    return NextResponse.json({ error: 'walletId and frozen (boolean) are required' }, { status: 400 })
  }

  const { db } = getDb()

  // Verify the wallet belongs to a user of this partner
  const [wallet] = await db
    .select({ id: wallets.id, userId: wallets.userId })
    .from(wallets)
    .where(eq(wallets.id, walletId))
    .limit(1)

  if (!wallet) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })

  const [mapping] = await db
    .select({ userId: partnerUsers.userId })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partnerId), eq(partnerUsers.userId, wallet.userId)))
    .limit(1)

  if (!mapping) {
    return NextResponse.json({ error: 'Wallet does not belong to a user of this partner' }, { status: 403 })
  }

  await db
    .update(wallets)
    .set({ frozen, updatedAt: new Date() })
    .where(eq(wallets.id, walletId))

  return NextResponse.json({ walletId, frozen })
}
