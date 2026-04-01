'use server'

import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { ethers } from 'ethers'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { wallets, users, auditLogs } from '@ntzs/db'
import { invalidateWalletCache } from '@/lib/user/cachedWallet'
import { sendTransaction as sendCdpTransaction } from '@/lib/waas/cdp-server'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'

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

const NTZS_TRANSFER_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
] as const

export type SendNtzsResult =
  | { success: true; txHash: string; amountTzs: number; toAddress: string }
  | { success: false; error: string }

/**
 * Send nTZS from the current user's CDP wallet to any EVM address on Base,
 * or to a platform user identified by their @alias.
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

  // Validate EVM address
  if (!ethers.isAddress(toAddress)) {
    return { success: false, error: 'Invalid address — must be a valid 0x… address or @alias' }
  }

  // Get sender wallet (CDP only for user-initiated sends)
  const fromWallet = await db.query.wallets.findFirst({
    where: and(eq(wallets.userId, dbUser.id), eq(wallets.chain, 'base')),
  })

  if (!fromWallet || fromWallet.address.startsWith('0x_pending_')) {
    return { success: false, error: 'Your wallet is not ready yet' }
  }
  if (fromWallet.provider !== 'coinbase_embedded') {
    return { success: false, error: 'Only embedded wallets can send from the app' }
  }

  if (toAddress.toLowerCase() === fromWallet.address.toLowerCase()) {
    return { success: false, error: 'Cannot send to your own wallet' }
  }

  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE
  const rpcUrl = BASE_RPC_URL
  if (!contractAddress || !rpcUrl) {
    return { success: false, error: 'Blockchain not configured — contact support' }
  }

  // Check balance
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const token = new ethers.Contract(contractAddress, NTZS_TRANSFER_ABI, provider)
  const balanceWei: bigint = await token.balanceOf(fromWallet.address)
  const amountWei = ethers.parseUnits(amountTzs.toFixed(18), 18)

  if (balanceWei < amountWei) {
    const available = parseFloat(ethers.formatUnits(balanceWei, 18))
    return {
      success: false,
      error: `Insufficient balance — you have ${available.toLocaleString(undefined, { maximumFractionDigits: 2 })} nTZS`,
    }
  }

  // Execute transfer via CDP
  const iface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)'])
  const encodedData = iface.encodeFunctionData('transfer', [toAddress, amountWei]) as `0x${string}`
  const result = await sendCdpTransaction(dbUser.id, dbUser.email, {
    evmAccount: fromWallet.address as `0x${string}`,
    network: 'base' as const,
    transaction: {
      to: contractAddress as `0x${string}`,
      data: encodedData,
      chainId: 8453,
      type: 'eip1559' as const,
    },
  })

  if ('error' in result) {
    return { success: false, error: result.error }
  }

  // Audit log
  await db.insert(auditLogs).values({
    action: 'user_send_ntzs',
    entityType: 'transfer',
    entityId: result.txHash,
    metadata: {
      fromUserId: dbUser.id,
      fromWallet: fromWallet.address,
      toAddress,
      amountTzs,
      txHash: result.txHash,
    },
  })

  return { success: true, txHash: result.txHash, amountTzs, toAddress }
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
