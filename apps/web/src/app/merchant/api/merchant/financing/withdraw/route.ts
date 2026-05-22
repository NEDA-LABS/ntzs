import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/merchant/db'
import { getDb } from '@/lib/db'
import { merchantAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/merchant/auth'
import { isValidTanzanianPhone, normalizePhone } from '@/lib/psp'

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [merchant] = await db
    .select({
      id: merchantAccounts.id,
      walletAddress: merchantAccounts.walletAddress,
      walletIndex: merchantAccounts.walletIndex,
      lenderPartnerId: merchantAccounts.lenderPartnerId,
      withdrawalLimitTzs: merchantAccounts.withdrawalLimitTzs,
      lenderControlsSettlement: merchantAccounts.lenderControlsSettlement,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, session.merchantId))
    .limit(1)

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!merchant.lenderPartnerId) {
    return NextResponse.json({ error: 'Not under a lender financing programme' }, { status: 403 })
  }
  if (merchant.withdrawalLimitTzs <= 0) {
    return NextResponse.json({ error: 'Withdrawals not enabled by your lender' }, { status: 403 })
  }

  const body = await req.json()
  const amountTzs = Math.trunc(Number(body.amountTzs))
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''

  if (!amountTzs || amountTzs <= 0) {
    return NextResponse.json({ error: 'amountTzs must be positive' }, { status: 400 })
  }
  if (amountTzs > merchant.withdrawalLimitTzs) {
    return NextResponse.json({
      error: `Amount exceeds per-request cap of TZS ${merchant.withdrawalLimitTzs.toLocaleString()}`,
    }, { status: 400 })
  }
  if (!phone || !isValidTanzanianPhone(phone)) {
    return NextResponse.json({ error: 'Valid Tanzanian phone number required' }, { status: 400 })
  }

  const normalizedPhone = normalizePhone(phone)

  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  if (!contractAddress) {
    return NextResponse.json({ error: 'Contract address not configured' }, { status: 500 })
  }

  // Resolve platform user for the burn request record
  const { sql: rawSql } = getDb()
  const platformEmail = process.env.PLATFORM_ADMIN_EMAIL || 'ops@nedapay.co.tz'
  const userRows = await rawSql<{ id: string }[]>`
    select id from users where email = ${platformEmail} limit 1
  `
  const platformUserId = userRows[0]?.id
  if (!platformUserId) {
    return NextResponse.json({ error: 'Platform user not configured' }, { status: 500 })
  }

  const walletRows = await rawSql<{ id: string }[]>`
    select id from wallets where user_id = ${platformUserId} and chain = 'base' limit 1
  `
  const platformWalletId = walletRows[0]?.id
  if (!platformWalletId) {
    return NextResponse.json({ error: 'Platform wallet not configured' }, { status: 500 })
  }

  const burnRows = await rawSql<{ id: string }[]>`
    insert into burn_requests (
      user_id, wallet_id, chain, contract_address,
      amount_tzs, reason, status,
      requested_by_user_id, recipient_phone,
      metadata, created_at, updated_at
    ) values (
      ${platformUserId}, ${platformWalletId}, 'base', ${contractAddress},
      ${amountTzs}, 'merchant_withdrawal', 'approved',
      ${platformUserId}, ${normalizedPhone},
      ${JSON.stringify({ merchantId: merchant.id, walletAddress: merchant.walletAddress, walletIndex: merchant.walletIndex })}::jsonb,
      now(), now()
    )
    returning id
  `
  const burnId = burnRows[0]?.id
  if (!burnId) {
    return NextResponse.json({ error: 'Failed to create withdrawal request' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, burnRequestId: burnId, amountTzs, phone: normalizedPhone }, { status: 201 })
}
