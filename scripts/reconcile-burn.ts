#!/usr/bin/env tsx
/**
 * One-off reconciliation script for an off-ramp burn stuck in
 * reconcile_required (or an older status=failed / payout_status=failed row).
 *
 * Safe-by-default: does nothing unless --apply is passed.
 *
 * Usage:
 *   # 1. Dry-run — inspect local row + live Snippe state
 *   tsx scripts/reconcile-burn.ts \
 *     --burn-id f39839f4-22b9-4cbf-9ffa-4a589a921209 \
 *     --snippe-ref SN1776763608...
 *
 *   # 2. Apply — re-verifies with Snippe, then re-mints if Snippe returns failed/reversed
 *   tsx scripts/reconcile-burn.ts \
 *     --burn-id f39839f4-22b9-4cbf-9ffa-4a589a921209 \
 *     --snippe-ref SN1776763608... \
 *     --apply
 *
 * Required env:
 *   DATABASE_URL
 *   SNIPPE_API_KEY
 *   BASE_RPC_URL
 *   NTZS_CONTRACT_ADDRESS_BASE
 *   MINTER_PRIVATE_KEY                (must hold MINTER_ROLE)
 *   BURNER_PRIVATE_KEY   (optional — falls back to MINTER if both roles granted)
 */

import { eq } from 'drizzle-orm'
import { ethers } from 'ethers'

import { getDb } from '../apps/web/src/lib/db'
import { checkPayoutStatus } from '../apps/web/src/lib/psp/snippe'
import { revertOffRampBurn } from '../apps/web/src/lib/minting/revertOffRampBurn'
import { burnRequests, wallets, auditLogs } from '@ntzs/db'

// ── arg parsing ──────────────────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}
const burnId = arg('burn-id')
const snippeRef = arg('snippe-ref')
const apply = process.argv.includes('--apply')

if (!burnId) {
  console.error('Usage: tsx scripts/reconcile-burn.ts --burn-id <uuid> [--snippe-ref <SN...>] [--apply]')
  process.exit(1)
}

// ── env sanity ───────────────────────────────────────────────────────────────
const requiredEnv = [
  'DATABASE_URL',
  'SNIPPE_API_KEY',
  'BASE_RPC_URL',
  'NTZS_CONTRACT_ADDRESS_BASE',
  'MINTER_PRIVATE_KEY',
]
const missing = requiredEnv.filter((k) => !process.env[k])
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`)
  process.exit(1)
}

async function main() {
  const { db } = getDb()

  // 1. Load burn
  const [burn] = await db
    .select()
    .from(burnRequests)
    .where(eq(burnRequests.id, burnId!))
    .limit(1)

  if (!burn) {
    console.error(`Burn request ${burnId} not found`)
    process.exit(1)
  }

  // 2. Load wallet
  const [userWallet] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(eq(wallets.id, burn.walletId))
    .limit(1)

  if (!userWallet) {
    console.error(`Wallet ${burn.walletId} not found — cannot safely reconcile`)
    process.exit(1)
  }

  console.log('─── Local burn row ────────────────────────────────────────────')
  console.log({
    id: burn.id,
    userId: burn.userId,
    walletAddress: userWallet.address,
    amountTzs: burn.amountTzs,
    platformFeeTzs: burn.platformFeeTzs,
    status: burn.status,
    payoutStatus: burn.payoutStatus,
    payoutReference: burn.payoutReference,
    payoutError: burn.payoutError,
    txHash: burn.txHash,
    feeTxHash: burn.feeTxHash,
    feeRecipientAddress: burn.feeRecipientAddress,
    recipientPhone: burn.recipientPhone,
    createdAt: burn.createdAt,
  })

  // 3. Verify on-chain that the burn actually happened (defensive — if the
  // txHash never confirmed we should NOT remint).
  if (!burn.txHash) {
    console.error(
      '\n✗ Burn has no on-chain tx hash. Nothing was actually burned; refusing to remint. Reset the row manually if you want to let the user retry.'
    )
    process.exit(1)
  }

  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL!)
  const receipt = await provider.getTransactionReceipt(burn.txHash)
  if (!receipt) {
    console.error(`\n✗ Burn tx ${burn.txHash} not found on-chain. Aborting.`)
    process.exit(1)
  }
  if (receipt.status !== 1) {
    console.error(`\n✗ Burn tx ${burn.txHash} reverted (status=${receipt.status}). Nothing was burned; refusing to remint.`)
    process.exit(1)
  }
  console.log(`\n✓ Burn tx ${burn.txHash} confirmed on-chain (block ${receipt.blockNumber})`)

  // 4. Fetch Snippe status
  const effectiveRef = burn.payoutReference ?? snippeRef ?? null
  if (!effectiveRef) {
    console.error(
      '\n✗ No Snippe reference available (local row missing + --snippe-ref not provided). Cannot auto-verify.'
    )
    process.exit(1)
  }
  console.log(`\nQuerying Snippe for reference ${effectiveRef}...`)
  const snippeState = await checkPayoutStatus(effectiveRef)
  console.log('─── Snippe state ──────────────────────────────────────────────')
  console.log(snippeState)

  if (snippeState.status === 'pending') {
    console.error(
      '\n✗ Snippe still reports status=pending (or the status endpoint was unreachable and defaulted to pending). Refusing to act. Re-run later when Snippe has moved to a terminal state.'
    )
    process.exit(1)
  }

  if (snippeState.status === 'completed') {
    console.log(
      '\n⚠ Snippe says the payout COMPLETED. The user actually received the fiat. Do NOT remint. Instead, run this SQL to mark the burn completed:'
    )
    console.log(
      `\n  UPDATE burn_requests SET status='burned', payout_status='completed', payout_reference='${effectiveRef}', updated_at=now() WHERE id='${burn.id}';\n`
    )
    process.exit(0)
  }

  // snippeState.status ∈ { 'failed', 'reversed' } — safe to revert
  console.log(
    `\n✓ Snippe confirms terminal failure state: ${snippeState.status} (reason: ${snippeState.failureReason ?? 'n/a'})`
  )
  console.log(`  User wallet to remint:  ${userWallet.address}`)
  console.log(`  Amount to remint:       ${burn.amountTzs.toLocaleString()} nTZS`)
  if (burn.feeTxHash) {
    console.log(
      `  Fee burn-back:          ${burn.platformFeeTzs?.toLocaleString() ?? 0} nTZS from ${burn.feeRecipientAddress ?? '(no address)'}`
    )
  } else {
    console.log(`  Fee burn-back:          none (feeTxHash is null — fee mint never happened)`)
  }

  if (!apply) {
    console.log('\nDry-run complete. Re-run with --apply to actually execute.')
    process.exit(0)
  }

  // 5. Execute the revert.
  console.log('\n=== APPLYING REVERT ===============================================')
  const revert = await revertOffRampBurn({
    burnRequestId: burn.id,
    userAddress: userWallet.address,
    burnAmountTzs: burn.amountTzs,
    platformFeeTzs: burn.platformFeeTzs,
    feeRecipientAddress: burn.feeRecipientAddress,
    feeMintOccurred: Boolean(burn.feeTxHash),
    reason: `cli_reconcile: snippe_status=${snippeState.status} reason=${snippeState.failureReason ?? 'n/a'} ref=${effectiveRef}`,
  })

  console.log('Revert result:', revert)

  if (revert.error) {
    console.error(
      `\n✗ Remint failed: ${revert.error}. Row has NOT been updated. Investigate manually before retrying.`
    )
    process.exit(1)
  }

  // 6. Update DB row.
  await db
    .update(burnRequests)
    .set({
      status: 'failed',
      payoutStatus: 'reverted',
      payoutReference: burn.payoutReference ?? effectiveRef,
      payoutError: `${burn.payoutError ?? ''} | cli_reverted (snippe: ${snippeState.status}, ref: ${effectiveRef})`,
      updatedAt: new Date(),
    })
    .where(eq(burnRequests.id, burn.id))

  await db.insert(auditLogs).values({
    action: 'burn.cli_reconciled_reverted',
    entityType: 'burn_request',
    entityId: burn.id,
    metadata: {
      snippeReference: effectiveRef,
      snippeStatus: snippeState.status,
      snippeFailureReason: snippeState.failureReason,
      remintTxHash: revert.remintTxHash,
      feeBurnTxHash: revert.feeBurnTxHash,
    },
  })

  console.log('\n✅ Reconciled.')
  console.log(`   remint tx:   ${revert.remintTxHash}`)
  if (revert.feeBurnTxHash) {
    console.log(`   fee-burn tx: ${revert.feeBurnTxHash}`)
  }
  console.log(`   Check on BaseScan: https://basescan.org/tx/${revert.remintTxHash}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
