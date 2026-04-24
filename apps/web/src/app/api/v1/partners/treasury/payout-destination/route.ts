import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { isValidTanzanianPhone, normalizePhone } from '@/lib/psp/snippe'
import { partners } from '@ntzs/db'
import { verifySessionToken } from '@/lib/waas/auth'

/**
 * POST /api/v1/partners/treasury/payout-destination
 * Save or update the partner's withdrawal payout destination.
 * Body: { type: 'mobile', phone: string }
 */
export async function POST(request: NextRequest) {
  const cookieToken = request.cookies.get('partner_session')?.value
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = cookieToken || bearerToken

  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const partnerId = verifySessionToken(token)
  if (!partnerId) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })

  let body: { type: string; phone?: string; bankAccount?: string; bankName?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { type, phone, bankAccount, bankName } = body

  if (!type || !['mobile', 'bank'].includes(type)) {
    return NextResponse.json({ error: 'type must be "mobile" or "bank"' }, { status: 400 })
  }

  const { db } = getDb()

  if (type === 'mobile') {
    if (!phone) return NextResponse.json({ error: 'phone is required for mobile type' }, { status: 400 })
    if (!isValidTanzanianPhone(phone)) {
      return NextResponse.json(
        { error: 'Invalid Tanzanian mobile money number. Use format: 07XXXXXXXX or 255XXXXXXXXX' },
        { status: 400 }
      )
    }
    const normalized = normalizePhone(phone)
    await db
      .update(partners)
      .set({ payoutPhone: normalized, payoutType: 'mobile', payoutBankAccount: null, payoutBankName: null, updatedAt: new Date() })
      .where(eq(partners.id, partnerId))
    return NextResponse.json({ payoutPhone: normalized, payoutType: 'mobile' })
  }

  // Bank account
  if (!bankAccount || !bankName) {
    return NextResponse.json({ error: 'bankAccount and bankName are required for bank type' }, { status: 400 })
  }
  if (bankAccount.trim().length < 6) {
    return NextResponse.json({ error: 'Invalid bank account number' }, { status: 400 })
  }

  await db
    .update(partners)
    .set({ payoutPhone: null, payoutType: 'bank', payoutBankAccount: bankAccount.trim(), payoutBankName: bankName.trim(), updatedAt: new Date() })
    .where(eq(partners.id, partnerId))

  return NextResponse.json({ payoutBankAccount: bankAccount.trim(), payoutBankName: bankName.trim(), payoutType: 'bank' })
}
