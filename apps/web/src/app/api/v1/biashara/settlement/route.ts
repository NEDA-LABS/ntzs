import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { db } from '@/lib/merchant/db'
import { merchantAccounts } from '@ntzs/db'
import { requireServiceKey } from '@/lib/service-auth'
import { isValidTanzanianPhone, normalizePhone } from '@/lib/psp'

/**
 * GET/PATCH /api/v1/biashara/settlement  (NEDApay service layer)
 * The merchant's auto-settlement payout preferences (percentage of each sale
 * paid out to mobile money + the payout phone). Mirrors the in-app
 * /merchant/api/merchant/settlement route — the app previously had no way to
 * read or set these at all. Blocked while a lender controls settlement.
 * Headers: x-service-key, x-merchant-id.
 */
export async function GET(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) return NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 })

  const [merchant] = await db
    .select({
      settlePct: merchantAccounts.settlePct,
      settlementPhone: merchantAccounts.settlementPhone,
      lenderControlsSettlement: merchantAccounts.lenderControlsSettlement,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    settlePct: merchant.settlePct,
    settlementPhone: merchant.settlementPhone,
    lenderControlsSettlement: merchant.lenderControlsSettlement,
  })
}

export async function PATCH(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) return NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 })

  const [merchant] = await db
    .select({ lenderControlsSettlement: merchantAccounts.lenderControlsSettlement })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (merchant.lenderControlsSettlement) {
    return NextResponse.json({ error: 'Settlement is managed by your lender.' }, { status: 403 })
  }

  const body = await req.json()
  const settlePct = Number(body.settlePct)
  const settlementPhone = typeof body.settlementPhone === 'string' ? body.settlementPhone.trim() : null

  if (!Number.isInteger(settlePct) || settlePct < 0 || settlePct > 100) {
    return NextResponse.json({ error: 'settlePct must be 0–100' }, { status: 400 })
  }

  if (settlePct > 0 && (!settlementPhone || !isValidTanzanianPhone(settlementPhone))) {
    return NextResponse.json({ error: 'Valid Tanzanian phone required for auto-settlement' }, { status: 400 })
  }

  await db
    .update(merchantAccounts)
    .set({
      settlePct,
      settlementPhone: settlementPhone ? normalizePhone(settlementPhone) : null,
      updatedAt: new Date(),
    })
    .where(eq(merchantAccounts.id, merchantId))

  return NextResponse.json({ ok: true })
}
