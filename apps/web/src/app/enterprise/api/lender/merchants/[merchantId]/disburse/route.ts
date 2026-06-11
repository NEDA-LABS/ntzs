import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, merchantAccounts, partners } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'
import { isValidTanzanianPhone, normalizePhone } from '@/lib/psp'
import { JsonRpcProvider, Contract } from 'ethers'

/**
 * POST /enterprise/api/lender/merchants/[merchantId]/disburse
 *
 * Lender-initiated disbursement: the lender sends capital to a linked merchant.
 * Reserves against the merchant's active loan facility, burns nTZS from the
 * lender's treasury, and pays mobile money to the merchant. Body: { amountTzs, phone? }.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params

  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [account] = await db
    .select({ partnerId: enterpriseAccounts.partnerId, type: enterpriseAccounts.type })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, session.enterpriseId))
    .limit(1)

  if (!account?.partnerId || account.type !== 'capital_lender') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [merchant] = await db
    .select({
      id: merchantAccounts.id,
      lenderPartnerId: merchantAccounts.lenderPartnerId,
      settlementPhone: merchantAccounts.settlementPhone,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant || merchant.lenderPartnerId !== account.partnerId) {
    return NextResponse.json({ error: 'Merchant is not under your financing programme' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const amountTzs = Math.trunc(Number(body.amountTzs))
  const phoneInput = typeof body.phone === 'string' && body.phone.trim()
    ? body.phone.trim()
    : (merchant.settlementPhone ?? '')

  if (!amountTzs || amountTzs <= 0) {
    return NextResponse.json({ error: 'amountTzs must be positive' }, { status: 400 })
  }
  if (!phoneInput || !isValidTanzanianPhone(phoneInput)) {
    return NextResponse.json({ error: 'A valid recipient phone is required (merchant has no settlement phone on file)' }, { status: 400 })
  }
  const recipientPhone = normalizePhone(phoneInput)

  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  if (!contractAddress) {
    return NextResponse.json({ error: 'Contract address not configured' }, { status: 500 })
  }

  const [partner] = await db
    .select({ treasuryWalletAddress: partners.treasuryWalletAddress })
    .from(partners)
    .where(eq(partners.id, account.partnerId))
    .limit(1)
  const lenderTreasury = partner?.treasuryWalletAddress
  if (!lenderTreasury) {
    return NextResponse.json({ error: 'Your treasury wallet is not provisioned' }, { status: 503 })
  }

  const { sql: rawSql } = getDb()

  // Reserve against the active loan facility (atomic; no overshoot of principal).
  const loanRows = await rawSql<{ id: string; principal_tzs: number; disbursed_tzs: number; repaid_tzs: number }[]>`
    select id, principal_tzs, disbursed_tzs, repaid_tzs
    from enterprise_loan_agreements
    where merchant_id = ${merchantId} and partner_id = ${account.partnerId} and status = 'active'
    order by created_at asc
    limit 1
  `
  const loan = loanRows[0]
  if (!loan) {
    return NextResponse.json({ error: 'No active loan agreement with this merchant. Set loan terms first.' }, { status: 400 })
  }

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
      error: `Amount exceeds available facility. You can disburse up to TZS ${Math.max(0, available).toLocaleString()}.`,
      availableTzs: Math.max(0, available),
    }, { status: 400 })
  }

  const releaseReservation = async () => {
    try {
      await rawSql`update enterprise_loan_agreements set disbursed_tzs = GREATEST(0, disbursed_tzs - ${amountTzs}), updated_at = now() where id = ${loan.id}`
    } catch (err) {
      console.error('[lender/disburse] CRITICAL: failed to release facility reservation', {
        loanId: loan.id, merchantId, amountTzs, error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  try {
    // Confirm the treasury actually holds enough nTZS (worker is the backstop).
    const rpcUrl = process.env.BASE_RPC_URL
    if (rpcUrl) {
      try {
        const provider = new JsonRpcProvider(rpcUrl)
        const token = new Contract(contractAddress, ['function balanceOf(address) view returns (uint256)'], provider)
        const balance: bigint = await token.balanceOf(lenderTreasury)
        const needed = BigInt(amountTzs) * (BigInt(10) ** BigInt(18))
        if (balance < needed) {
          await releaseReservation()
          const haveTzs = Number(balance / (BigInt(10) ** BigInt(18)))
          return NextResponse.json({
            error: `Your treasury holds only TZS ${haveTzs.toLocaleString()}. Top up to disburse this amount.`,
            availableTzs: haveTzs,
          }, { status: 400 })
        }
      } catch (err) {
        console.error('[lender/disburse] treasury balance check failed (continuing):', err instanceof Error ? err.message : err)
      }
    }

    // Platform user/wallet only satisfy the burn_request FK; the actual burn
    // source is burn_from_address (the lender treasury).
    const platformEmail = process.env.PLATFORM_ADMIN_EMAIL || 'ops@nedapay.co.tz'
    const userRows = await rawSql<{ id: string }[]>`select id from users where email = ${platformEmail} limit 1`
    const platformUserId = userRows[0]?.id
    if (!platformUserId) { await releaseReservation(); return NextResponse.json({ error: 'Platform user not configured' }, { status: 500 }) }

    const walletRows = await rawSql<{ id: string }[]>`select id from wallets where user_id = ${platformUserId} and chain = 'base' limit 1`
    const platformWalletId = walletRows[0]?.id
    if (!platformWalletId) { await releaseReservation(); return NextResponse.json({ error: 'Platform wallet not configured' }, { status: 500 }) }

    const burnRows = await rawSql<{ id: string }[]>`
      insert into burn_requests (
        user_id, wallet_id, chain, contract_address,
        amount_tzs, reason, status,
        requested_by_user_id, recipient_phone, burn_from_address,
        created_at, updated_at
      ) values (
        ${platformUserId}, ${platformWalletId}, 'base', ${contractAddress},
        ${amountTzs}, 'lender_disbursement', 'approved',
        ${platformUserId}, ${recipientPhone}, ${lenderTreasury},
        now(), now()
      )
      returning id
    `
    const burnId = burnRows[0]?.id
    if (!burnId) { await releaseReservation(); return NextResponse.json({ error: 'Failed to create disbursement' }, { status: 500 }) }

    await rawSql`
      insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
      values (
        'lender_disbursement', 'burn_request', ${burnId},
        ${JSON.stringify({ merchantId, lenderPartnerId: account.partnerId, loanId: loan.id, amountTzs, recipientPhone, initiatedBy: 'lender' })}::jsonb,
        now()
      )
    `

    return NextResponse.json({ ok: true, burnRequestId: burnId, amountTzs, phone: recipientPhone }, { status: 201 })
  } catch (err) {
    await releaseReservation()
    console.error('[lender/disburse] failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to create disbursement' }, { status: 500 })
  }
}
