/**
 * Platform HD Wallet provisioning for direct end-users.
 *
 * Direct users (those who sign up via the web app rather than via a partner
 * WaaS API) are assigned a wallet derived from the platform's own HD seed.
 *
 * Derivation path: m/44'/8453'/0'/0/{walletIndex}
 * The walletIndex is stored in providerWalletRef and is sequential based on
 * the count of existing platform_hd wallets.
 */

import { eq, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { wallets } from '@ntzs/db'
import { deriveAddress } from './hd-wallets'

export async function provisionPlatformWallet(userId: string): Promise<string | null> {
  const platformSeed = process.env.PLATFORM_HD_SEED

  if (!platformSeed) {
    console.warn('[platform-wallets] PLATFORM_HD_SEED not set — skipping auto-provision')
    return null
  }

  const { db } = getDb()

  // Return early if this user already has any wallet
  const existing = await db.query.wallets.findFirst({
    where: eq(wallets.userId, userId),
  })

  if (existing) return existing.address

  // Use the count of existing platform_hd wallets as the next index.
  // This is safe because we insert with the derived address, and the
  // unique constraint on (chain, address) will catch any collision.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(wallets)
    .where(eq(wallets.provider, 'platform_hd'))

  const walletIndex = Number(count)
  const address = deriveAddress(platformSeed, walletIndex)

  await db.insert(wallets).values({
    userId,
    chain: 'base',
    address,
    provider: 'platform_hd',
    providerWalletRef: String(walletIndex),
  })

  console.log(`[platform-wallets] Provisioned wallet for user ${userId} at index ${walletIndex}: ${address}`)

  return address
}
