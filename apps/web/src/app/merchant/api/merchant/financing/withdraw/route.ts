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
  // Per-draw cap (Rule 1): a single withdrawal can never exceed the lender's
  // per-request limit, so a merchant can't pull their whole facility at once.
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

  const { sql: rawSql } = getDb()

  // ── Facility reservation (Rule 2: revolving outstanding cap) ────────────────
  // A merchant draws against the principal of their *active* loan agreement.
  // The ceiling is on the OUTSTANDING balance, so repayments free capacity back
  // up: available = principal_tzs - (disbursed_tzs - repaid_tzs).
  //
  // The reservation is a single conditional UPDATE so the check-and-increment is
  // atomic — concurrent withdrawals can't both pass the cap (no TOCTOU race).
  // If the merchant has no active loan agreement we fall back to the per-request
  // cap only (already enforced above), per product decision.
  const loanRows = await rawSql<{
    id: string
    principal_tzs: number
    disbursed_tzs: number
    repaid_tzs: number
  }[]>`
    select id, principal_tzs, disbursed_tzs, repaid_tzs
    from enterprise_loan_agreements
    where merchant_id = ${merchant.id}
      and partner_id = ${merchant.lenderPartnerId}
      and status = 'active'
    order by created_at asc
    limit 1
  `
  const loan = loanRows[0]
  let reservedLoanId: string | null = null

  if (loan) {
    const reserved = await rawSql<{ id: string }[]>`
      update enterprise_loan_agreements
      set disbursed_tzs = disbursed_tzs + ${amountTzs}, updated_at = now()
      where id = ${loan.id}
        and status = 'active'
        and (disbursed_tzs - repaid_tzs) + ${amountTzs} <= principal_tzs
      returning id
    `
    if (!reserved[0]) {
      const available = loan.principal_tzs - (loan.disbursed_tzs - loan.repaid_tzs)
      return NextResponse.json({
        error: `Amount exceeds available financing. You can draw up to TZS ${Math.max(0, available).toLocaleString()}.`,
        availableTzs: Math.max(0, available),
      }, { status: 400 })
    }
    reservedLoanId = loan.id
  }

  // Helper to release the reservation if anything downstream fails, so a failed
  // withdrawal never permanently consumes a merchant's facility.
  const releaseReservation = async () => {
    if (!reservedLoanId) return
    try {
      await rawSql`
        update enterprise_loan_agreements
        set disbursed_tzs = GREATEST(0, disbursed_tzs - ${amountTzs}), updated_at = now()
        where id = ${reservedLoanId}
      `
    } catch (err) {
      console.error('[merchant/withdraw] CRITICAL: failed to release facility reservation', {
        loanId: reservedLoanId, merchantId: merchant.id, amountTzs,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  try {
    // Resolve platform user/wallet that fronts the financing liquidity.
    const platformEmail = process.env.PLATFORM_ADMIN_EMAIL || 'ops@nedapay.co.tz'
    const userRows = await rawSql<{ id: string }[]>`
      select id from users where email = ${platformEmail} limit 1
    `
    const platformUserId = userRows[0]?.id
    if (!platformUserId) {
      await releaseReservation()
      return NextResponse.json({ error: 'Platform user not configured' }, { status: 500 })
    }

    const walletRows = await rawSql<{ id: string }[]>`
      select id from wallets where user_id = ${platformUserId} and chain = 'base' limit 1
    `
    const platformWalletId = walletRows[0]?.id
    if (!platformWalletId) {
      await releaseReservation()
      return NextResponse.json({ error: 'Platform wallet not configured' }, { status: 500 })
    }

    const burnRows = await rawSql<{ id: string }[]>`
      insert into burn_requests (
        user_id, wallet_id, chain, contract_address,
        amount_tzs, reason, status,
        requested_by_user_id, recipient_phone,
        created_at, updated_at
      ) values (
        ${platformUserId}, ${platformWalletId}, 'base', ${contractAddress},
        ${amountTzs}, 'merchant_withdrawal', 'approved',
        ${platformUserId}, ${normalizedPhone},
        now(), now()
      )
      returning id
    `
    const burnId = burnRows[0]?.id
    if (!burnId) {
      await releaseReservation()
      return NextResponse.json({ error: 'Failed to create withdrawal request' }, { status: 500 })
    }

    // Attribute the burn to the merchant + loan for ops/reconciliation. burn_requests
    // has no metadata column, so the linkage lives in audit_logs.
    await rawSql`
      insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
      values (
        'merchant_withdrawal_requested', 'burn_request', ${burnId},
        ${JSON.stringify({
          merchantId: merchant.id,
          walletAddress: merchant.walletAddress,
          walletIndex: merchant.walletIndex,
          loanId: reservedLoanId,
          amountTzs,
          recipientPhone: normalizedPhone,
        })}::jsonb,
        now()
      )
    `

    return NextResponse.json({ ok: true, burnRequestId: burnId, amountTzs, phone: normalizedPhone }, { status: 201 })
  } catch (err) {
    await releaseReservation()
    console.error('[merchant/withdraw] failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to create withdrawal request' }, { status: 500 })
  }
}
