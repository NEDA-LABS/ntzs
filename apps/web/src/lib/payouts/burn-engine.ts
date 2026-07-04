/**
 * Burn executor — ported from apps/worker/src/burn-worker.ts so it can run as
 * a Vercel Cron (/api/cron/process-burns). The standalone worker is not
 * deployed, so every fiat off-ramp (merchant auto-settlement, merchant
 * financing withdrawals, enterprise disbursements) was inserting `approved`
 * burn_requests that nothing ever executed.
 *
 * For each approved burn request: burn the nTZS on-chain (from
 * burn_from_address when set — e.g. a lender treasury — else the request's
 * wallet), mint the platform fee to a treasury (best-effort), then pay the
 * recipient mobile money via the PSP. The deployed payout webhook completes
 * the loop by marking payout_status = 'completed'.
 *
 * ENTIRE ENGINE IS GATED by BURN_CRON_ENABLED === 'true' (checked by the cron
 * routes, not here) so it ships dark and is switched on deliberately — old
 * stuck approved requests will start executing the moment it's enabled.
 */
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { sendPayout, ACTIVE_PSP_PAYOUT_WEBHOOK_PATH } from '@/lib/psp'
import { netPayoutTzs } from './payout-math'

type SqlClient = ReturnType<typeof getDb>['sql']

const NTZS_BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function mint(address to, uint256 amount)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
] as const

const WEI_PER_TZS = BigInt(10) ** BigInt(18)

function isAddressLike(v: unknown): v is string {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)
}

async function logAudit(sql: SqlClient, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
  await sql`
    insert into audit_logs (action, entity_type, entity_id, metadata, created_at)
    values (${action}, ${entityType}, ${entityId}, ${JSON.stringify(metadata)}::jsonb, now())
  `
}

interface BurnJob {
  id: string
  wallet_id: string
  amount_tzs: number
  platform_fee_tzs: number | null
  chain: string
  contract_address: string
  recipient_phone: string | null
  user_id: string
  burn_from_address: string | null
}

/** Claim the oldest approved burn request atomically (skip-locked). */
async function claimNextBurnJob(sql: SqlClient): Promise<BurnJob | null> {
  const rows = await sql<BurnJob[]>`
    update burn_requests
    set status = 'burn_submitted', updated_at = now()
    where id = (
      select id
      from burn_requests
      where status = 'approved'
      order by created_at asc
      for update skip locked
      limit 1
    )
    returning id, wallet_id, amount_tzs, platform_fee_tzs, chain, contract_address, recipient_phone, user_id, burn_from_address
  `
  return rows[0] ?? null
}

async function processOneBurn(sql: SqlClient, job: BurnJob): Promise<void> {
  const rpcUrl = process.env.BASE_RPC_URL
  const privateKey = process.env.BURNER_PRIVATE_KEY || process.env.MINTER_PRIVATE_KEY
  if (!rpcUrl || !privateKey) throw new Error('BASE_RPC_URL / BURNER_PRIVATE_KEY (or MINTER_PRIVATE_KEY) not configured')

  const walletRows = await sql<{ address: string }[]>`
    select address from wallets where id = ${job.wallet_id} limit 1
  `
  const walletAddress = walletRows[0]?.address
  if (!walletAddress) throw new Error('Missing wallet address for burn request')

  const burnFromAddress = job.burn_from_address ?? walletAddress

  // Always use the current env contract address — DB rows may carry stale
  // (testnet) addresses.
  const activeContractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE || job.contract_address
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const signer = new ethers.Wallet(privateKey, provider)
  const token = new ethers.Contract(activeContractAddress, NTZS_BURN_ABI, signer)

  const burnerRole: string = await token.BURNER_ROLE()
  const hasBurner: boolean = await token.hasRole(burnerRole, await signer.getAddress())
  if (!hasBurner) throw new Error('Signer does not have BURNER_ROLE on contract')

  const amountWei = BigInt(String(job.amount_tzs)) * WEI_PER_TZS
  const tx = await token.burn(burnFromAddress, amountWei)

  await sql`update burn_requests set tx_hash = ${tx.hash}, updated_at = now() where id = ${job.id}`
  await tx.wait(1)
  await sql`update burn_requests set status = 'burned', updated_at = now() where id = ${job.id}`

  // Mint the platform fee to a treasury (partner's if the user belongs to one,
  // else the global platform treasury). Best-effort: a fee failure must not
  // block the recipient's payout.
  if (job.platform_fee_tzs != null && job.platform_fee_tzs > 0) {
    const partnerTreasuryRows = await sql<{ treasury_wallet_address: string | null }[]>`
      select p.treasury_wallet_address
      from partner_users pu
      join partners p on p.id = pu.partner_id
      where pu.user_id = ${job.user_id}
      limit 1
    `
    const partnerTreasury = partnerTreasuryRows[0]?.treasury_wallet_address
    const platformTreasury = (process.env.PLATFORM_TREASURY_ADDRESS || '').replace(/^["']|["']$/g, '')
    const feeRecipient = isAddressLike(partnerTreasury) ? partnerTreasury : isAddressLike(platformTreasury) ? platformTreasury : null

    if (feeRecipient) {
      try {
        const feeTx = await token.mint(feeRecipient, BigInt(String(job.platform_fee_tzs)) * WEI_PER_TZS)
        await feeTx.wait(1)
        await sql`
          update burn_requests
          set fee_tx_hash = ${feeTx.hash}, fee_recipient_address = ${feeRecipient}, updated_at = now()
          where id = ${job.id}
        `
        await logAudit(sql, 'burn_fee_minted', 'burn_request', job.id, { platformFeeTzs: job.platform_fee_tzs, feeRecipient, feeTxHash: feeTx.hash })
      } catch (feeErr) {
        const feeErrMsg = feeErr instanceof Error ? feeErr.message : String(feeErr)
        console.error('[burn-engine] fee mint failed (non-fatal)', { burnRequestId: job.id, error: feeErrMsg })
        await logAudit(sql, 'burn_fee_mint_failed', 'burn_request', job.id, { platformFeeTzs: job.platform_fee_tzs, feeRecipient, error: feeErrMsg })
      }
    } else {
      console.warn('[burn-engine] no treasury address configured — platform fee kept as implicit reserve surplus', { burnRequestId: job.id, platformFeeTzs: job.platform_fee_tzs })
    }
  }

  await logAudit(sql, 'burn_completed', 'burn_request', job.id, {
    amountTzs: job.amount_tzs, walletAddress, burnedFrom: burnFromAddress, txHash: tx.hash, chain: job.chain, contractAddress: activeContractAddress,
  })
  console.log('[burn-engine] burned', { burnRequestId: job.id, txHash: tx.hash, amountTzs: job.amount_tzs })

  // Fiat leg: pay the recipient's phone. The payout webhook flips
  // payout_status to 'completed' when the cash lands.
  if (job.recipient_phone) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ntzs.co.tz'
    const payoutAmountTzs = netPayoutTzs({ amountTzs: job.amount_tzs, platformFeeTzs: job.platform_fee_tzs })

    const payoutResult = await sendPayout({
      amountTzs: payoutAmountTzs,
      recipientPhone: job.recipient_phone,
      recipientName: 'nTZS User',
      narration: 'nTZS withdrawal',
      webhookUrl: `${appUrl}${ACTIVE_PSP_PAYOUT_WEBHOOK_PATH}`,
      metadata: { burn_request_id: job.id },
    })

    if (payoutResult.success && payoutResult.reference) {
      await sql`
        update burn_requests
        set payout_reference = ${payoutResult.reference}, payout_status = 'pending', updated_at = now()
        where id = ${job.id}
      `
      await logAudit(sql, 'payout_initiated', 'burn_request', job.id, { payoutReference: payoutResult.reference, amountTzs: payoutAmountTzs, recipientPhone: job.recipient_phone })
      console.log('[burn-engine] payout initiated', { burnRequestId: job.id, payoutReference: payoutResult.reference })
    } else {
      await sql`
        update burn_requests
        set payout_status = 'failed',
            payout_reference = ${payoutResult.reference ?? null},
            payout_error = ${payoutResult.error ?? 'Unknown error'},
            updated_at = now()
        where id = ${job.id}
      `
      await logAudit(sql, 'payout_failed', 'burn_request', job.id, { amountTzs: payoutAmountTzs, error: payoutResult.error, reference: payoutResult.reference })
      console.error('[burn-engine] payout failed', { burnRequestId: job.id, error: payoutResult.error })
    }
  }
}

/**
 * Execute up to `limit` approved burn requests. Returns how many were
 * attempted (claimed). A failed burn is marked status='failed' with the error
 * and does not block the rest.
 */
export async function processApprovedBurns(sql: SqlClient, limit: number): Promise<number> {
  let processed = 0
  for (let i = 0; i < limit; i++) {
    const job = await claimNextBurnJob(sql)
    if (!job) break
    processed += 1
    try {
      await processOneBurn(sql, job)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      await sql`
        update burn_requests
        set status = 'failed', error = ${errorMessage}, updated_at = now()
        where id = ${job.id}
      `
      await logAudit(sql, 'burn_failed', 'burn_request', job.id, { amountTzs: job.amount_tzs, error: errorMessage, chain: job.chain })
      console.error('[burn-engine] burn_failed', { burnRequestId: job.id, error: errorMessage })
    }
  }
  return processed
}
