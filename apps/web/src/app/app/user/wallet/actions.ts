'use server'

import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { ethers } from 'ethers'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { wallets, users, auditLogs } from '@ntzs/db'
import { invalidateWalletCache } from '@/lib/user/cachedWallet'
import { invalidateSendsCache } from '@/lib/user/cachedQueries'
import { getUserPrimaryWallet } from '@/lib/user/getUserPrimaryWallet'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, MINTER_PRIVATE_KEY, BURNER_PRIVATE_KEY } from '@/lib/env'

export type AliasResult =
  | { success: true; alias: string }
  | { success: false; error: string }

export async function updatePayAlias(formData: FormData): Promise<AliasResult> {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const raw = String(formData.get('alias') ?? '').trim().toLowerCase()

  // Only allow alphanumeric, hyphens, underscores, 3-30 chars
  if (!/^[a-z0-9_-]{3,30}$/.test(raw)) {
    return { success: false, error: 'Alias must be 3-30 characters (letters, numbers, - or _)' }
  }

  const { db } = getDb()

  // Check uniqueness
  const existing = await db.query.users.findFirst({
    where: eq(users.payAlias, raw),
  })

  if (existing && existing.id !== dbUser.id) {
    return { success: false, error: 'This alias is already taken' }
  }

  await db
    .update(users)
    .set({ payAlias: raw, updatedAt: new Date() })
    .where(eq(users.id, dbUser.id))

  revalidatePath('/app/user/wallet')

  return { success: true, alias: raw }
}

// ─── Send nTZS ────────────────────────────────────────────────────────────────

const NTZS_SEND_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function burn(address from, uint256 amount)',
  'function mint(address to, uint256 amount)',
  'function paused() view returns (bool)',
] as const

export type SendNtzsResult =
  | { success: true; burnTxHash: string; mintTxHash: string; amountTzs: number; toAddress: string }
  | { success: false; error: string }

/**
 * Send nTZS from the current user's wallet to any EVM address on Base,
 * or to a platform user identified by their @alias.
 *
 * Uses a custodial burn-then-mint pattern:
 *   1. BURNER_ROLE burns from sender's wallet
 *   2. MINTER_ROLE mints to recipient's address
 * No user private key required — platform keys handle both steps.
 */
export async function sendNtzsAction(formData: FormData): Promise<SendNtzsResult> {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const rawTo = String(formData.get('to') ?? '').trim()
  const rawAmount = String(formData.get('amount') ?? '').trim()

  if (!rawTo || !rawAmount) {
    return { success: false, error: 'Recipient and amount are required' }
  }

  const amountTzs = parseFloat(rawAmount)
  if (!Number.isFinite(amountTzs) || amountTzs <= 0) {
    return { success: false, error: 'Enter a valid amount' }
  }

  const { db } = getDb()

  // Resolve @alias → wallet address
  let toAddress = rawTo
  if (rawTo.startsWith('@') || !rawTo.startsWith('0x')) {
    const alias = rawTo.replace(/^@/, '').toLowerCase()
    const targetUser = await db.query.users.findFirst({
      where: eq(users.payAlias, alias),
    })
    if (!targetUser) {
      return { success: false, error: `No user found with alias @${alias}` }
    }
    const [targetWallet] = await db
      .select({ address: wallets.address })
      .from(wallets)
      .where(and(eq(wallets.userId, targetUser.id), eq(wallets.chain, 'base')))
      .limit(1)
    if (!targetWallet) {
      return { success: false, error: `@${alias} does not have a wallet yet` }
    }
    toAddress = targetWallet.address
  }

  if (!ethers.isAddress(toAddress)) {
    return { success: false, error: 'Invalid address — must be a valid 0x… address or @alias' }
  }

  // Preflight wallet check against the primary (for pending / self-send guards)
  const primaryWallet = await getUserPrimaryWallet(dbUser.id)
  if (!primaryWallet || primaryWallet.address.startsWith('0x_pending_')) {
    return { success: false, error: 'Your wallet is not ready yet' }
  }

  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE
  const rpcUrl = BASE_RPC_URL
  // BURNER_PRIVATE_KEY falls back to MINTER_PRIVATE_KEY — same key holds both roles
  const signerKey = BURNER_PRIVATE_KEY || MINTER_PRIVATE_KEY

  if (!contractAddress || !rpcUrl || !signerKey) {
    return { success: false, error: 'Platform not configured — contact support' }
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const signer = new ethers.Wallet(signerKey, provider)
  const token = new ethers.Contract(contractAddress, NTZS_SEND_ABI, signer)

  // Check contract is not paused
  const paused: boolean = await token.paused()
  if (paused) {
    return { success: false, error: 'Transfers are temporarily paused — try again later' }
  }

  // Scan ALL user base wallets for balance — handles CDP/HD provider mismatch
  // where tokens may have been minted to a different address than the current
  // primary wallet. Burn from whichever address actually holds the funds.
  const amountWei = ethers.parseUnits(amountTzs.toFixed(18), 18)
  const userWallets = await db.query.wallets.findMany({
    where: and(
      eq(wallets.userId, dbUser.id),
      eq(wallets.chain, 'base'),
      eq(wallets.frozen, false),
    ),
  })
  if (!userWallets.length) {
    return { success: false, error: 'Your wallet is not ready yet' }
  }

  let fromWallet: (typeof userWallets)[0] | null = null
  let maxBalanceWei = BigInt(0)
  for (const w of userWallets) {
    if (w.address.startsWith('0x_pending_')) continue
    const balWei: bigint = await token.balanceOf(w.address)
    if (balWei >= amountWei) {
      fromWallet = w
      break
    }
    if (balWei > maxBalanceWei) maxBalanceWei = balWei
  }

  if (!fromWallet) {
    const available = parseFloat(ethers.formatUnits(maxBalanceWei, 18))
    return {
      success: false,
      error: `Insufficient balance — you have ${available.toLocaleString(undefined, { maximumFractionDigits: 2 })} nTZS`,
    }
  }

  if (toAddress.toLowerCase() === fromWallet.address.toLowerCase()) {
    return { success: false, error: 'Cannot send to your own wallet' }
  }

  // Step 1: burn from sender — submit only, no confirmation wait
  let burnTxHash: string
  try {
    const burnTx = await token.burn(fromWallet.address, amountWei)
    burnTxHash = burnTx.hash
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Failed to debit your wallet: ${msg}` }
  }

  // Step 2: mint to recipient — submit only, no confirmation wait
  let mintTxHash: string
  try {
    const mintTx = await token.mint(toAddress, amountWei)
    mintTxHash = mintTx.hash
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sendNtzsAction] Mint failed after burn — attempting refund', { burnTxHash, fromWallet: fromWallet.address, amountTzs, error: msg })

    // Attempt automatic refund
    try {
      const refundTx = await token.mint(fromWallet.address, amountWei)
      await db.insert(auditLogs).values({
        action: 'user_send_ntzs_refunded',
        entityType: 'transfer',
        entityId: burnTxHash,
        metadata: { fromUserId: dbUser.id, fromWallet: fromWallet.address, toAddress, amountTzs, burnTxHash, refundTxHash: refundTx.hash, mintError: msg },
      })
      return { success: false, error: 'Transfer failed — your balance has been refunded. Please try again.' }
    } catch (refundErr) {
      const refundMsg = refundErr instanceof Error ? refundErr.message : String(refundErr)
      console.error('[sendNtzsAction] CRITICAL: Burn succeeded but mint AND refund failed', { burnTxHash, fromWallet: fromWallet.address, amountTzs, mintError: msg, refundError: refundMsg })
      await db.insert(auditLogs).values({
        action: 'user_send_ntzs_failed_unrecovered',
        entityType: 'transfer',
        entityId: burnTxHash,
        metadata: { fromUserId: dbUser.id, fromWallet: fromWallet.address, toAddress, amountTzs, burnTxHash, mintError: msg, refundError: refundMsg },
      })
      return { success: false, error: 'Transfer failed. Our team has been notified and will restore your balance within 24 hours.' }
    }
  }

  // Audit log
  await db.insert(auditLogs).values({
    action: 'user_send_ntzs',
    entityType: 'transfer',
    entityId: burnTxHash,
    metadata: {
      fromUserId: dbUser.id,
      fromWallet: fromWallet.address,
      toAddress,
      amountTzs,
      burnTxHash,
      mintTxHash,
    },
  })

  invalidateSendsCache(dbUser.id)
  revalidatePath('/app/user/activity')

  return { success: true, burnTxHash, mintTxHash, amountTzs, toAddress }
}

// ─── Wallet setup ─────────────────────────────────────────────────────────────

export async function saveEmbeddedWalletAction(formData: FormData) {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const address = String(formData.get('address') ?? '').trim()

  if (!address) {
    throw new Error('Missing wallet address')
  }

  const { db } = getDb()

  const existing = await db.query.wallets.findFirst({
    where: and(eq(wallets.userId, dbUser.id), eq(wallets.chain, 'base')),
  })

  if (existing) {
    if (existing.address.toLowerCase() !== address.toLowerCase()) {
      await db
        .update(wallets)
        .set({
          address,
          provider: 'coinbase_embedded',
          updatedAt: new Date(),
        })
        .where(eq(wallets.id, existing.id))

      invalidateWalletCache(dbUser.id)
      revalidatePath('/app/user')
      revalidatePath('/app/user/wallet')
    }

    return
  }

  await db.insert(wallets).values({
    userId: dbUser.id,
    chain: 'base',
    address,
    provider: 'coinbase_embedded',
  })

  invalidateWalletCache(dbUser.id)
  revalidatePath('/app/user')
  revalidatePath('/app/user/wallet')
}

// ─── Legacy wallet migration ──────────────────────────────────────────────────

export type MigrateLegacyResult =
  | { success: true; migratedTzs: number; fromAddress: string; toAddress: string; burnTxHash: string; mintTxHash: string }
  | { success: false; error: string }
  | { success: true; migratedTzs: 0; noop: true }

/**
 * Server-side burn-and-remint migration:
 *   - Finds any wallet rows for the current user that are NOT the primary
 *     (platform_hd) wallet, checks each for an on-chain nTZS balance, and
 *     moves the balance into the primary wallet.
 *   - Uses BURNER_ROLE + MINTER_ROLE — no user signature required.
 *
 * Idempotent: safe to call repeatedly. Returns { noop: true } if nothing to migrate.
 */
export async function migrateLegacyWalletAction(): Promise<MigrateLegacyResult> {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const { db } = getDb()

  const primary = await getUserPrimaryWallet(dbUser.id)
  if (!primary || primary.address.startsWith('0x_pending_')) {
    return { success: false, error: 'Your primary wallet is not ready yet' }
  }

  const allWallets = await db
    .select({ id: wallets.id, address: wallets.address, provider: wallets.provider })
    .from(wallets)
    .where(and(eq(wallets.userId, dbUser.id), eq(wallets.chain, 'base')))

  const legacyWallets = allWallets.filter(
    (w) => w.id !== primary.id && !w.address.startsWith('0x_pending_'),
  )

  if (legacyWallets.length === 0) {
    return { success: true, migratedTzs: 0, noop: true }
  }

  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE
  const rpcUrl = BASE_RPC_URL
  const signerKey = BURNER_PRIVATE_KEY || MINTER_PRIVATE_KEY

  if (!contractAddress || !rpcUrl || !signerKey) {
    return { success: false, error: 'Platform not configured — contact support' }
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const signer = new ethers.Wallet(signerKey, provider)
  const token = new ethers.Contract(contractAddress, NTZS_SEND_ABI, signer)

  const paused: boolean = await token.paused()
  if (paused) {
    return { success: false, error: 'Transfers are temporarily paused — try again later' }
  }

  // Process the first legacy wallet with a non-zero balance.
  // If there are multiple, user can re-run migration to clear the rest.
  for (const legacy of legacyWallets) {
    let balanceWei: bigint
    try {
      balanceWei = await token.balanceOf(legacy.address)
    } catch (err) {
      console.error('[migrateLegacyWallet] balanceOf failed', { wallet: legacy.address, err })
      continue
    }

    if (balanceWei === BigInt(0)) continue

    const migratedTzs = Number(balanceWei / BigInt(10) ** BigInt(18))

    // Step 1: burn from legacy
    let burnTxHash: string
    try {
      const burnTx = await token.burn(legacy.address, balanceWei)
      burnTxHash = burnTx.hash
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Failed to burn from legacy wallet: ${msg}` }
    }

    // Step 2: mint to primary
    let mintTxHash: string
    try {
      const mintTx = await token.mint(primary.address, balanceWei)
      mintTxHash = mintTx.hash
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[migrateLegacyWallet] CRITICAL: burn succeeded but mint failed — attempting refund', {
        burnTxHash, legacy: legacy.address, balanceWei: balanceWei.toString(), err: msg,
      })
      try {
        const refundTx = await token.mint(legacy.address, balanceWei)
        await db.insert(auditLogs).values({
          action: 'wallet_migration_refunded',
          entityType: 'wallet',
          entityId: legacy.id,
          actorUserId: dbUser.id,
          metadata: { fromAddress: legacy.address, toAddress: primary.address, amountTzs: migratedTzs, burnTxHash, refundTxHash: refundTx.hash, mintError: msg },
        })
        return { success: false, error: 'Migration failed — your legacy balance was restored. Please try again.' }
      } catch (refundErr) {
        const refundMsg = refundErr instanceof Error ? refundErr.message : String(refundErr)
        await db.insert(auditLogs).values({
          action: 'wallet_migration_failed_unrecovered',
          entityType: 'wallet',
          entityId: legacy.id,
          actorUserId: dbUser.id,
          metadata: { fromAddress: legacy.address, toAddress: primary.address, amountTzs: migratedTzs, burnTxHash, mintError: msg, refundError: refundMsg },
        })
        return { success: false, error: 'Migration failed. Our team has been notified and will restore your balance within 24 hours.' }
      }
    }

    // Success — audit log
    await db.insert(auditLogs).values({
      action: 'wallet_migration_completed',
      entityType: 'wallet',
      entityId: legacy.id,
      actorUserId: dbUser.id,
      metadata: {
        fromAddress: legacy.address,
        toAddress: primary.address,
        amountTzs: migratedTzs,
        burnTxHash,
        mintTxHash,
        legacyWalletProvider: legacy.provider,
      },
    })

    invalidateWalletCache(dbUser.id)
    revalidatePath('/app/user')
    revalidatePath('/app/user/wallet')
    revalidatePath('/app/user/activity')

    return {
      success: true,
      migratedTzs,
      fromAddress: legacy.address,
      toAddress: primary.address,
      burnTxHash,
      mintTxHash,
    }
  }

  // No legacy wallet had a balance — already migrated or never had funds
  return { success: true, migratedTzs: 0, noop: true }
}

/**
 * Public query for the dashboard banner: returns non-zero balance in any
 * legacy wallet (for the prompt).
 */
export async function getLegacyWalletBalance(): Promise<{ amountTzs: number; fromAddress: string } | null> {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const { db } = getDb()

  const primary = await getUserPrimaryWallet(dbUser.id)
  if (!primary) return null

  const allWallets = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, dbUser.id), eq(wallets.chain, 'base')))

  const legacy = allWallets.filter((w) => w.id !== primary.id && !w.address.startsWith('0x_pending_'))
  if (legacy.length === 0) return null

  if (!BASE_RPC_URL || !NTZS_CONTRACT_ADDRESS_BASE) return null

  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
  const token = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, ['function balanceOf(address) view returns (uint256)'], provider)

  for (const w of legacy) {
    try {
      const bal = await token.balanceOf(w.address) as bigint
      if (bal > BigInt(0)) {
        return { amountTzs: Number(bal / BigInt(10) ** BigInt(18)), fromAddress: w.address }
      }
    } catch {}
  }

  return null
}
