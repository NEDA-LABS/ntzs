import { and, desc, eq, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL } from '@/lib/env'
import { deriveAddress, fundWalletWithGas } from '@/lib/waas/hd-wallets'
import { kycCases, partnerUsers, partners, wallets } from '@ntzs/db'

/**
 * Issue the wallet an approved partner user is entitled to.
 *
 * Approval and issuance used to be separate events: something approved the KYC
 * case, and the wallet only appeared when the partner happened to call
 * create-user again. So a user could be approved — by our reviewer, by their
 * own provider — and still have no wallet, with nobody's queue showing it. The
 * fix is to make issuance a consequence of approval, from every approval path,
 * which means it has to live in one function that all of them call.
 *
 * STRUCTURAL PREREQUISITE (BoT Parameter 8): the identity check is INSIDE this
 * function, not at its call sites. No end-user wallet is issued without an
 * approved KYC case, and no future caller can forget that rule.
 *
 * Idempotent and safe to call repeatedly: an existing wallet is returned
 * untouched. Gas prefunding is best-effort and never blocks the result.
 */
export type WalletProvisionResult =
  | { status: 'created'; address: string }
  | { status: 'existing'; address: string }
  | { status: 'skipped'; reason: 'kyc_not_approved' | 'not_a_partner_user' | 'partner_seed_missing' }

export async function provisionWalletForApprovedUser(userId: string): Promise<WalletProvisionResult> {
  const { db } = getDb()

  const [existing] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
    .limit(1)
  if (existing) return { status: 'existing', address: existing.address }

  const [latestCase] = await db
    .select({ status: kycCases.status })
    .from(kycCases)
    .where(eq(kycCases.userId, userId))
    .orderBy(desc(kycCases.createdAt))
    .limit(1)
  if (latestCase?.status !== 'approved') return { status: 'skipped', reason: 'kyc_not_approved' }

  const [mapping] = await db
    .select({ id: partnerUsers.id, partnerId: partnerUsers.partnerId, walletIndex: partnerUsers.walletIndex })
    .from(partnerUsers)
    .where(eq(partnerUsers.userId, userId))
    .limit(1)
  // Direct-app users get their wallet from the consumer signup flow, not here.
  if (!mapping) return { status: 'skipped', reason: 'not_a_partner_user' }

  const [partner] = await db
    .select({ encryptedHdSeed: partners.encryptedHdSeed })
    .from(partners)
    .where(eq(partners.id, mapping.partnerId))
    .limit(1)
  if (!partner?.encryptedHdSeed) return { status: 'skipped', reason: 'partner_seed_missing' }

  // A mapping with no claimed index would otherwise be permanently unissuable.
  // Claiming one here costs an index and unblocks the user.
  let walletIndex = mapping.walletIndex
  if (walletIndex === null) {
    const [claimed] = await db
      .update(partners)
      .set({ nextWalletIndex: sql`${partners.nextWalletIndex} + 1`, updatedAt: new Date() })
      .where(eq(partners.id, mapping.partnerId))
      .returning({ next: partners.nextWalletIndex })
    walletIndex = (claimed?.next ?? 1) - 1
    await db.update(partnerUsers).set({ walletIndex }).where(eq(partnerUsers.id, mapping.id))
  }

  const address = deriveAddress(partner.encryptedHdSeed, walletIndex)

  await db.insert(wallets).values({ userId, chain: 'base', address, provider: 'external' }).onConflictDoNothing()

  // Re-read rather than trusting the insert: a concurrent approval may have
  // won the race, and the address on the row is the one that counts.
  const [row] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
    .limit(1)
  const finalAddress = row?.address ?? address

  if (BASE_RPC_URL) {
    fundWalletWithGas({ toAddress: finalAddress, rpcUrl: BASE_RPC_URL }).catch((err) =>
      console.error('[provisionWallet] Gas prefund failed for', finalAddress, err?.message)
    )
  }

  return { status: 'created', address: finalAddress }
}
