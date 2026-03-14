import { ethers } from 'ethers'
import { eq, and, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { depositRequests, mintTransactions, dailyIssuance, wallets, auditLogs } from '@ntzs/db'
import { BASE_RPC_URL, MINTER_PRIVATE_KEY, NTZS_CONTRACT_ADDRESS_BASE as NTZS_CONTRACT_ADDRESS } from '@/lib/env'

const DAILY_ISSUANCE_CAP_TZS = Number(process.env.DAILY_ISSUANCE_CAP_TZS ?? '100000000')

const NTZS_ABI = [
  'function mint(address to, uint256 amount)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
] as const

// MINTER_ROLE is an immutable constant on the contract — fetch once and reuse within the process lifetime.
// In serverless this is per warm-instance but still saves at least one RPC call per warm invocation.
let _cachedMinterRole: string | null = null
async function getMinterRole(token: ethers.Contract): Promise<string> {
  if (!_cachedMinterRole) {
    _cachedMinterRole = await token.MINTER_ROLE() as string
  }
  return _cachedMinterRole as string
}

function getTodayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

export type MintResult =
  | { status: 'minted'; depositId: string; txHash: string; amountTzs: number }
  | { status: 'skipped'; reason: string }
  | { status: 'cap_exceeded'; depositId: string }
  | { status: 'failed'; depositId: string; error: string }

/**
 * Attempt to mint nTZS for a single deposit that is in `mint_pending` state.
 * Safe to call concurrently — uses optimistic locking (claim by status update).
 */
export async function executeMint(depositId: string): Promise<MintResult> {
  if (!MINTER_PRIVATE_KEY) return { status: 'skipped', reason: 'MINTER_PRIVATE_KEY not configured' }
  if (!NTZS_CONTRACT_ADDRESS) return { status: 'skipped', reason: 'Contract address not configured' }

  const { db } = getDb()

  // Atomically claim the job: only succeeds if it is still mint_pending
  const [claimed] = await db
    .update(depositRequests)
    .set({ status: 'mint_processing', updatedAt: new Date() })
    .where(and(eq(depositRequests.id, depositId), eq(depositRequests.status, 'mint_pending')))
    .returning({
      id: depositRequests.id,
      walletId: depositRequests.walletId,
      amountTzs: depositRequests.amountTzs,
      chain: depositRequests.chain,
    })

  if (!claimed) {
    return { status: 'skipped', reason: 'not_mint_pending_or_already_claimed' }
  }

  const job = claimed

  // Create / reset mint transaction record
  await db
    .insert(mintTransactions)
    .values({
      depositRequestId: job.id,
      chain: job.chain,
      contractAddress: NTZS_CONTRACT_ADDRESS,
      status: 'processing',
    })
    .onConflictDoUpdate({
      target: mintTransactions.depositRequestId,
      set: { status: 'processing', contractAddress: NTZS_CONTRACT_ADDRESS, updatedAt: new Date() },
    })

  // Daily issuance cap check + wallet lookup in parallel
  const today = getTodayUTC()
  await db
    .insert(dailyIssuance)
    .values({ day: today, capTzs: DAILY_ISSUANCE_CAP_TZS, reservedTzs: 0, issuedTzs: 0 })
    .onConflictDoNothing()

  const [[dailyRow], [wallet]] = await Promise.all([
    db
      .select({ reservedTzs: dailyIssuance.reservedTzs, issuedTzs: dailyIssuance.issuedTzs, capTzs: dailyIssuance.capTzs })
      .from(dailyIssuance)
      .where(eq(dailyIssuance.day, today))
      .limit(1),
    db
      .select({ address: wallets.address })
      .from(wallets)
      .where(eq(wallets.id, job.walletId))
      .limit(1),
  ])

  if (dailyRow && dailyRow.reservedTzs + dailyRow.issuedTzs + job.amountTzs > dailyRow.capTzs) {
    await db.update(depositRequests).set({ status: 'mint_pending', updatedAt: new Date() }).where(eq(depositRequests.id, job.id))
    await db.update(mintTransactions).set({ status: 'cap_exceeded', error: 'Daily issuance cap reached', updatedAt: new Date() }).where(eq(mintTransactions.depositRequestId, job.id))
    return { status: 'cap_exceeded', depositId: job.id }
  }

  if (!wallet?.address) {
    await db.update(depositRequests).set({ status: 'mint_failed', updatedAt: new Date() }).where(eq(depositRequests.id, job.id))
    await db.update(mintTransactions).set({ status: 'failed', error: 'Wallet address not found', updatedAt: new Date() }).where(eq(mintTransactions.depositRequestId, job.id))
    return { status: 'failed', depositId: job.id, error: 'Wallet address not found' }
  }

  // Reserve amount
  await db
    .update(dailyIssuance)
    .set({ reservedTzs: sql`${dailyIssuance.reservedTzs} + ${job.amountTzs}`, updatedAt: new Date() })
    .where(eq(dailyIssuance.day, today))

  try {

    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const signer = new ethers.Wallet(MINTER_PRIVATE_KEY, provider)
    const token = new ethers.Contract(NTZS_CONTRACT_ADDRESS, NTZS_ABI, signer)

    // Run gas balance check and MINTER_ROLE fetch in parallel — saves ~800ms vs sequential
    const MIN_MINTER_ETH = ethers.parseEther('0.001')
    const [minterBalance] = await Promise.all([
      provider.getBalance(signer.address),
      getMinterRole(token), // warms the cache; result not needed here
    ])
    if (minterBalance < MIN_MINTER_ETH) {
      throw new Error(
        `Minter wallet low on gas: ${ethers.formatEther(minterBalance)} ETH. Fund ${signer.address} with at least 0.001 ETH.`
      )
    }

    const amountWei = BigInt(String(job.amountTzs)) * BigInt(10) ** BigInt(18)
    const tx = await token.mint(wallet.address, amountWei)

    await db
      .update(mintTransactions)
      .set({ txHash: tx.hash, status: 'submitted', updatedAt: new Date() })
      .where(eq(mintTransactions.depositRequestId, job.id))

    await tx.wait(1)

    // Commit all post-confirmation writes in parallel
    await Promise.all([
      db.update(dailyIssuance)
        .set({
          issuedTzs: sql`${dailyIssuance.issuedTzs} + ${job.amountTzs}`,
          reservedTzs: sql`${dailyIssuance.reservedTzs} - ${job.amountTzs}`,
          updatedAt: new Date(),
        })
        .where(eq(dailyIssuance.day, today)),
      db.update(mintTransactions)
        .set({ status: 'minted', updatedAt: new Date() })
        .where(eq(mintTransactions.depositRequestId, job.id)),
      db.update(depositRequests)
        .set({ status: 'minted', mintedAt: new Date(), updatedAt: new Date() })
        .where(eq(depositRequests.id, job.id)),
      db.insert(auditLogs).values({
        action: 'mint_completed',
        entityType: 'deposit_request',
        entityId: job.id,
        metadata: { amountTzs: job.amountTzs, walletAddress: wallet.address, txHash: tx.hash, chain: job.chain },
      }),
    ])

    console.log(`[executeMint] Minted ${job.id}`, { txHash: tx.hash, amountTzs: job.amountTzs })
    return { status: 'minted', depositId: job.id, txHash: tx.hash, amountTzs: job.amountTzs }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    await db
      .update(dailyIssuance)
      .set({ reservedTzs: sql`GREATEST(0, ${dailyIssuance.reservedTzs} - ${job.amountTzs})`, updatedAt: new Date() })
      .where(eq(dailyIssuance.day, today))

    await db.update(mintTransactions).set({ status: 'failed', error: errorMessage, updatedAt: new Date() }).where(eq(mintTransactions.depositRequestId, job.id))
    await db.update(depositRequests).set({ status: 'mint_failed', updatedAt: new Date() }).where(eq(depositRequests.id, job.id))

    await db.insert(auditLogs).values({
      action: 'mint_failed',
      entityType: 'deposit_request',
      entityId: job.id,
      metadata: { amountTzs: job.amountTzs, error: errorMessage, chain: job.chain },
    })

    console.error(`[executeMint] Failed ${job.id}:`, errorMessage)
    return { status: 'failed', depositId: job.id, error: errorMessage }
  }
}
