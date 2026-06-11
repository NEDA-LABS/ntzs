import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, merchantAccounts, partners } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'
import { JsonRpcProvider, Contract, parseEther } from 'ethers'
import { deriveTreasuryWallet, fundWalletWithGas } from '@/lib/waas/hd-wallets'

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]

/**
 * POST /enterprise/api/lender/merchants/[merchantId]/disburse
 *
 * Lender-initiated disbursement: the lender SENDS nTZS from their treasury
 * directly into the merchant's on-chain wallet (no burn, no fiat payout — the
 * capital stays as nTZS so it can keep circulating in-network). Reserves against
 * the merchant's active loan facility. Body: { amountTzs }.
 *
 * The merchant off-ramps to fiat themselves via the merchant financing-withdraw
 * flow when they need cash.
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
      walletAddress: merchantAccounts.walletAddress,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!merchant || merchant.lenderPartnerId !== account.partnerId) {
    return NextResponse.json({ error: 'Merchant is not under your financing programme' }, { status: 404 })
  }
  if (!merchant.walletAddress) {
    return NextResponse.json({ error: 'Merchant has no wallet to receive funds' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const amountTzs = Math.trunc(Number(body.amountTzs))
  if (!amountTzs || amountTzs <= 0) {
    return NextResponse.json({ error: 'amountTzs must be positive' }, { status: 400 })
  }

  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  const rpcUrl = process.env.BASE_RPC_URL
  if (!contractAddress || !rpcUrl) {
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  const [partner] = await db
    .select({ treasuryWalletAddress: partners.treasuryWalletAddress, encryptedHdSeed: partners.encryptedHdSeed })
    .from(partners)
    .where(eq(partners.id, account.partnerId))
    .limit(1)
  if (!partner?.treasuryWalletAddress || !partner.encryptedHdSeed) {
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
    const provider = new JsonRpcProvider(rpcUrl)
    const treasurySigner = deriveTreasuryWallet(partner.encryptedHdSeed).connect(provider)
    const token = new Contract(contractAddress, ERC20_ABI, treasurySigner)

    const amountWei = BigInt(amountTzs) * (BigInt(10) ** BigInt(18))

    // Treasury must actually hold the nTZS.
    const balance: bigint = await token.balanceOf(treasurySigner.address)
    if (balance < amountWei) {
      await releaseReservation()
      const haveTzs = Number(balance / (BigInt(10) ** BigInt(18)))
      return NextResponse.json({
        error: `Your treasury holds only TZS ${haveTzs.toLocaleString()}. Top up to send this amount.`,
        availableTzs: haveTzs,
      }, { status: 400 })
    }

    // Ensure the treasury wallet has gas for the transfer.
    try {
      const gasBalance = await provider.getBalance(treasurySigner.address)
      if (gasBalance < parseEther('0.00003')) {
        await fundWalletWithGas({ toAddress: treasurySigner.address, rpcUrl, amountEth: '0.00005' })
      }
    } catch (err) {
      console.warn('[lender/disburse] gas top-up check failed (continuing):', err instanceof Error ? err.message : err)
    }

    // Transfer nTZS treasury → merchant wallet.
    const tx = await (token as unknown as { transfer: (to: string, amount: bigint) => Promise<{ hash: string; wait: (n?: number) => Promise<unknown> }> })
      .transfer(merchant.walletAddress, amountWei)
    await tx.wait(1)
    const txHash = tx.hash

    // Record the disbursement (platform user satisfies the transfers FK; metadata
    // marks it as a lender→merchant capital injection, not a user transfer).
    const platformEmail = process.env.PLATFORM_ADMIN_EMAIL || 'ops@nedapay.co.tz'
    const userRows = await rawSql<{ id: string }[]>`select id from users where email = ${platformEmail} limit 1`
    const platformUserId = userRows[0]?.id
    if (platformUserId) {
      await rawSql`
        insert into transfers (partner_id, from_user_id, to_address, token, amount_tzs, tx_hash, status, metadata, created_at, updated_at)
        values (
          ${account.partnerId}, ${platformUserId}, ${merchant.walletAddress}, 'ntzs', ${amountTzs}, ${txHash}, 'completed',
          ${JSON.stringify({ reason: 'lender_disbursement', merchantId, lenderPartnerId: account.partnerId, loanId: loan.id })}::jsonb,
          now(), now()
        )
      `
    }
    await rawSql`
      insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
      values ('lender_disbursement', 'enterprise_loan_agreement', ${loan.id},
        ${JSON.stringify({ merchantId, lenderPartnerId: account.partnerId, amountTzs, txHash, toWallet: merchant.walletAddress, initiatedBy: 'lender' })}::jsonb,
        now())
    `

    return NextResponse.json({ ok: true, txHash, amountTzs, toWallet: merchant.walletAddress }, { status: 201 })
  } catch (err) {
    await releaseReservation()
    console.error('[lender/disburse] transfer failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Disbursement transfer failed. Please try again.' }, { status: 500 })
  }
}
