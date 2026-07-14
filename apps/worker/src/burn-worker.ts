/**
 * Burn Worker
 * Processes approved burn_requests: calls token.burn() on-chain,
 * then triggers Snippe payout to the recipient's phone.
 *
 * Follows the same atomic claim + process + commit pattern as the mint worker.
 */

import { ethers } from 'ethers'
import { createDbClient } from '@ntzs/db'
import { adapterForTag, SNIPPE_FLAT_FEE_TZS } from '@ntzs/psp'

const NTZS_BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function mint(address to, uint256 amount)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
] as const

/**
 * Very light Ethereum-address validator — worker avoids pulling in ethers
 * utilities for a single check; this is sufficient for our 0x-prefixed
 * 40-hex-char addresses stored in the DB / env.
 */
function isAddressLike(v: unknown): v is string {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)
}

async function logAudit(
  sql: ReturnType<typeof createDbClient>['sql'],
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>
): Promise<void> {
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
  // Explicit burn source (e.g. a lender treasury). Overrides wallet_id when set.
  burn_from_address: string | null
  // PSP stamped at request-creation; NULL = legacy row (Snippe).
  payout_provider: string | null
  psp_fee_tzs: number | null
}

/**
 * Kill switch (G3): true when disbursements are paused via env override or the
 * `system_flags` row. When paused the worker leaves approved burns queued so
 * they resume once unpaused. A flag-read failure is treated as NOT paused (the
 * worker needs the DB anyway; a deliberate halt uses one of the two sources).
 */
async function disbursementsPaused(
  sql: ReturnType<typeof createDbClient>['sql']
): Promise<boolean> {
  if (process.env.DISBURSEMENTS_PAUSED === '1') return true
  try {
    const rows = await sql<{ enabled: boolean }[]>`
      select enabled from system_flags where key = 'disbursements_paused' limit 1
    `
    return Boolean(rows[0]?.enabled)
  } catch (err) {
    console.error('[burn-worker] flag read failed (treating as not paused):', err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Claim the next approved burn request atomically
 */
async function claimNextBurnJob(
  sql: ReturnType<typeof createDbClient>['sql']
): Promise<BurnJob | null> {
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
    returning id, wallet_id, amount_tzs, platform_fee_tzs, chain, contract_address, recipient_phone, user_id, burn_from_address, payout_provider, psp_fee_tzs
  `

  return rows[0] ?? null
}

/**
 * Process a single burn job: burn on-chain, then trigger payout
 */
export async function processBurnJob(
  databaseUrl: string,
  rpcUrl: string,
  privateKey: string,
  apiBaseUrl: string,
  platformTreasuryAddress: string = ''
): Promise<boolean> {
  const { sql } = createDbClient(databaseUrl)

  // Kill switch (G3): leave approved burns queued while disbursements are paused.
  if (await disbursementsPaused(sql)) {
    await sql.end({ timeout: 5 })
    return false
  }

  const job = await claimNextBurnJob(sql)
  if (!job) {
    await sql.end({ timeout: 5 })
    return false
  }

  try {
    // Get wallet address
    const walletRows = await sql<{ address: string }[]>`
      select address from wallets where id = ${job.wallet_id} limit 1
    `
    const walletAddress = walletRows[0]?.address
    if (!walletAddress) {
      throw new Error('Missing wallet address for burn request')
    }

    // Burn from an explicit address when set (e.g. a lender's treasury for
    // merchant financing disbursements); otherwise from the wallet_id address.
    const burnFromAddress = job.burn_from_address ?? walletAddress

    // Execute burn on-chain
    // Always use the current env contract address — DB records may have stale addresses from testnet
    const activeContractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE || job.contract_address
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const signer = new ethers.Wallet(privateKey, provider)
    const token = new ethers.Contract(activeContractAddress, NTZS_BURN_ABI, signer)

    // Verify burner role
    const burnerRole: string = await token.BURNER_ROLE()
    const hasBurner: boolean = await token.hasRole(burnerRole, await signer.getAddress())
    if (!hasBurner) {
      throw new Error('Signer does not have BURNER_ROLE on contract')
    }

    const amountWei = BigInt(String(job.amount_tzs)) * 10n ** 18n
    const tx = await token.burn(burnFromAddress, amountWei)

    // Update with tx hash
    await sql`
      update burn_requests
      set tx_hash = ${tx.hash}, updated_at = now()
      where id = ${job.id}
    `

    // Wait for confirmation
    await tx.wait(1)

    // Mark burn as complete
    await sql`
      update burn_requests
      set status = 'burned', updated_at = now()
      where id = ${job.id}
    `

    // ── Mint platform fee to treasury (best-effort, non-fatal) ────────────
    // Prefer partner treasury when the burn is tied to a partner user,
    // else fall back to the global platform treasury.
    if (job.platform_fee_tzs != null && job.platform_fee_tzs > 0) {
      const partnerTreasuryRows = await sql<{ treasury_wallet_address: string | null }[]>`
        select p.treasury_wallet_address
        from partner_users pu
        join partners p on p.id = pu.partner_id
        where pu.user_id = ${job.user_id}
        limit 1
      `
      const partnerTreasury = partnerTreasuryRows[0]?.treasury_wallet_address
      const feeRecipient = isAddressLike(partnerTreasury)
        ? partnerTreasury
        : isAddressLike(platformTreasuryAddress)
          ? platformTreasuryAddress
          : null

      if (feeRecipient) {
        try {
          const feeAmountWei = BigInt(String(job.platform_fee_tzs)) * 10n ** 18n
          const feeTx = await token.mint(feeRecipient, feeAmountWei)
          await feeTx.wait(1)
          await sql`
            update burn_requests
            set fee_tx_hash = ${feeTx.hash},
                fee_recipient_address = ${feeRecipient},
                updated_at = now()
            where id = ${job.id}
          `
          await logAudit(sql, 'burn_fee_minted', 'burn_request', job.id, {
            platformFeeTzs: job.platform_fee_tzs,
            feeRecipient,
            feeTxHash: feeTx.hash,
          })
        } catch (feeErr) {
          const feeErrMsg = feeErr instanceof Error ? feeErr.message : String(feeErr)
          console.error('[burn-worker] fee mint failed (non-fatal)', { burnRequestId: job.id, error: feeErrMsg })
          await logAudit(sql, 'burn_fee_mint_failed', 'burn_request', job.id, {
            platformFeeTzs: job.platform_fee_tzs,
            feeRecipient,
            error: feeErrMsg,
          })
        }
      } else {
        console.warn('[burn-worker] no treasury address configured — platform fee kept as implicit reserve surplus', { burnRequestId: job.id, platformFeeTzs: job.platform_fee_tzs })
      }
    }

    await logAudit(sql, 'burn_completed', 'burn_request', job.id, {
      amountTzs: job.amount_tzs,
      walletAddress,
      burnedFrom: burnFromAddress,
      txHash: tx.hash,
      chain: job.chain,
      contractAddress: job.contract_address,
    })

    console.log('[burn-worker] burned', { burnRequestId: job.id, txHash: tx.hash, amountTzs: job.amount_tzs })

    // Trigger the payout via the PSP STAMPED on the record (NULL = legacy
    // Snippe) — never the currently-routed provider.
    const adapter = adapterForTag(job.payout_provider)
    if (job.recipient_phone && !adapter) {
      await sql`
        update burn_requests
        set payout_status = 'failed', payout_error = ${'no live adapter for provider tag ' + job.payout_provider}, updated_at = now()
        where id = ${job.id}
      `
      console.error('[burn-worker] no live adapter for stamped provider', { burnRequestId: job.id, payoutProvider: job.payout_provider })
    } else if (job.recipient_phone && adapter) {
      const webhookUrl = `${apiBaseUrl}${adapter.payoutWebhookPath}`
      // The PSP's `amount` = net amount recipient receives. If the burn request
      // was grossed-up (platform_fee_tzs set), back out the recipient net using
      // the stamped PSP fee; otherwise pay the full burn amount (legacy flows).
      const payoutAmountTzs = job.platform_fee_tzs != null
        ? job.amount_tzs - job.platform_fee_tzs - (job.psp_fee_tzs ?? SNIPPE_FLAT_FEE_TZS)
        : job.amount_tzs
      const payoutResult = await adapter.sendPayout({
        amountTzs: payoutAmountTzs,
        recipientPhone: job.recipient_phone,
        recipientName: 'nTZS User',
        narration: 'nTZS withdrawal',
        webhookUrl,
        metadata: { burn_request_id: job.id },
      })

      if (payoutResult.success) {
        await sql`
          update burn_requests
          set payout_reference = ${payoutResult.reference!},
              payout_status = 'pending',
              payout_provider = coalesce(payout_provider, ${adapter.id}),
              updated_at = now()
          where id = ${job.id}
        `

        await logAudit(sql, 'payout_initiated', 'burn_request', job.id, {
          payoutReference: payoutResult.reference,
          amountTzs: job.amount_tzs,
          recipientPhone: job.recipient_phone,
        })

        console.log('[burn-worker] payout initiated', {
          burnRequestId: job.id,
          payoutReference: payoutResult.reference,
        })
      } else {
        await sql`
          update burn_requests
          set payout_status = 'failed',
              payout_error = ${payoutResult.error ?? 'Unknown error'},
              updated_at = now()
          where id = ${job.id}
        `

        await logAudit(sql, 'payout_failed', 'burn_request', job.id, {
          amountTzs: job.amount_tzs,
          error: payoutResult.error,
        })

        console.error('[burn-worker] payout failed', {
          burnRequestId: job.id,
          error: payoutResult.error,
        })
      }
    }

    await sql.end({ timeout: 5 })
    return true
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    await sql`
      update burn_requests
      set status = 'failed', error = ${errorMessage}, updated_at = now()
      where id = ${job.id}
    `

    await logAudit(sql, 'burn_failed', 'burn_request', job.id, {
      amountTzs: job.amount_tzs,
      error: errorMessage,
      chain: job.chain,
    })

    console.error('[burn-worker] burn_failed', { burnRequestId: job.id, error: errorMessage })

    await sql.end({ timeout: 5 })
    return true
  }
}
