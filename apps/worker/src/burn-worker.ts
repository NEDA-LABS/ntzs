/**
 * Burn Worker
 * Processes approved burn_requests: calls token.burn() on-chain,
 * then triggers Snippe payout to the recipient's phone.
 *
 * Follows the same atomic claim + process + commit pattern as the mint worker.
 */

import { ethers } from 'ethers'
import { createDbClient } from '@ntzs/db'

const SNIPPE_BASE_URL = 'https://api.snippe.sh'

const NTZS_BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
] as const

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
  chain: string
  contract_address: string
  recipient_phone: string | null
  user_id: string
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
    returning id, wallet_id, amount_tzs, chain, contract_address, recipient_phone, user_id
  `

  return rows[0] ?? null
}

/**
 * Send a Snippe payout after a successful burn
 */
async function triggerSnippePayout(
  burnRequestId: string,
  amountTzs: number,
  recipientPhone: string,
  webhookUrl: string,
  apiKey: string
): Promise<{ success: boolean; reference?: string; error?: string }> {
  // Normalize phone: strip +, ensure 255XXXXXXXXX
  let phone = recipientPhone.replace(/[\s\-+]/g, '')
  if (phone.startsWith('0')) phone = '255' + phone.substring(1)
  if (!phone.startsWith('255')) phone = '255' + phone

  try {
    const response = await fetch(`${SNIPPE_BASE_URL}/v1/payouts/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountTzs,
        channel: 'mobile',
        recipient_phone: phone,
        recipient_name: 'nTZS User',
        narration: 'nTZS withdrawal',
        ...(webhookUrl?.startsWith('https://') ? { webhook_url: webhookUrl } : {}),
        metadata: { burn_request_id: burnRequestId },
      }),
    })

    const result = await response.json() as {
      status: string
      message?: string
      data?: { reference: string }
    }

    if (result.status !== 'success' || !result.data?.reference) {
      return { success: false, error: result.message || 'Payout initiation failed' }
    }

    return { success: true, reference: result.data.reference }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Payout API error' }
  }
}

/**
 * Process a single burn job: burn on-chain, then trigger payout
 */
export async function processBurnJob(
  databaseUrl: string,
  rpcUrl: string,
  privateKey: string,
  snippeApiKey: string,
  apiBaseUrl: string
): Promise<boolean> {
  const { sql } = createDbClient(databaseUrl)

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

    // Execute burn on-chain
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const signer = new ethers.Wallet(privateKey, provider)
    const token = new ethers.Contract(job.contract_address, NTZS_BURN_ABI, signer)

    // Verify burner role
    const burnerRole: string = await token.BURNER_ROLE()
    const hasBurner: boolean = await token.hasRole(burnerRole, await signer.getAddress())
    if (!hasBurner) {
      throw new Error('Signer does not have BURNER_ROLE on contract')
    }

    const amountWei = BigInt(String(job.amount_tzs)) * 10n ** 18n
    const tx = await token.burn(walletAddress, amountWei)

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

    await logAudit(sql, 'burn_completed', 'burn_request', job.id, {
      amountTzs: job.amount_tzs,
      walletAddress,
      txHash: tx.hash,
      chain: job.chain,
      contractAddress: job.contract_address,
    })

    console.log('[burn-worker] burned', { burnRequestId: job.id, txHash: tx.hash, amountTzs: job.amount_tzs })

    // Trigger Snippe payout if recipient phone is set
    if (job.recipient_phone && snippeApiKey) {
      const webhookUrl = `${apiBaseUrl}/api/webhooks/snippe/payout`
      const payoutResult = await triggerSnippePayout(
        job.id,
        job.amount_tzs,
        job.recipient_phone,
        webhookUrl,
        snippeApiKey
      )

      if (payoutResult.success) {
        await sql`
          update burn_requests
          set payout_reference = ${payoutResult.reference!},
              payout_status = 'pending',
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
