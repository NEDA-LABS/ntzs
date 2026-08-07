import { and, eq } from 'drizzle-orm'

import { db as fxDb } from '@/lib/fx/db'
import { getDb } from '@/lib/db'
import { lpAccounts, users, wallets } from '@ntzs/db'

/**
 * Resolve the main-DB records an LP needs to move money that touches supply.
 *
 * SimpleFX accounts live in their own table, but deposits and burns are
 * ledgered against `users`/`wallets` like any other holder — so an LP is
 * mirrored as a synthetic user keyed on its wallet address. Both funding and
 * cash-out resolve through here, so they can never land against different
 * identities for the same LP.
 */
export interface LpLedgerIdentity {
  lp: { walletAddress: string; email: string; walletIndex: number; isActive: boolean }
  userId: string
  walletId: string
  bankId: string
  mainDb: ReturnType<typeof getDb>['db']
}

export async function resolveLpLedgerIdentity(
  lpId: string,
): Promise<{ error: string; status: number } | LpLedgerIdentity> {
  const [lp] = await fxDb
    .select({
      walletAddress: lpAccounts.walletAddress,
      email: lpAccounts.email,
      walletIndex: lpAccounts.walletIndex,
      isActive: lpAccounts.isActive,
    })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, lpId))
    .limit(1)

  if (!lp) return { error: 'LP account not found', status: 404 }

  const { db: mainDb, sql } = getDb()
  const syntheticNeonId = `lp_${lp.walletAddress.toLowerCase()}`

  let [lpUser] = await mainDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.neonAuthUserId, syntheticNeonId))
    .limit(1)

  if (!lpUser) {
    const [created] = await mainDb
      .insert(users)
      .values({ neonAuthUserId: syntheticNeonId, email: lp.email, role: 'end_user' })
      .onConflictDoNothing()
      .returning({ id: users.id })
    if (created) lpUser = created
    else {
      const [refetch] = await mainDb
        .select({ id: users.id })
        .from(users)
        .where(eq(users.neonAuthUserId, syntheticNeonId))
        .limit(1)
      if (!refetch) return { error: 'Failed to resolve LP user', status: 500 }
      lpUser = refetch
    }
  }

  let [lpWallet] = await mainDb
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.userId, lpUser.id), eq(wallets.chain, 'base')))
    .limit(1)

  if (!lpWallet) {
    const [created] = await mainDb
      .insert(wallets)
      .values({ userId: lpUser.id, chain: 'base', address: lp.walletAddress, provider: 'external' })
      .onConflictDoNothing()
      .returning({ id: wallets.id })
    if (created) lpWallet = created
    else {
      const [refetch] = await mainDb
        .select({ id: wallets.id })
        .from(wallets)
        .where(and(eq(wallets.userId, lpUser.id), eq(wallets.chain, 'base')))
        .limit(1)
      if (!refetch) return { error: 'Failed to resolve LP wallet', status: 500 }
      lpWallet = refetch
    }
  }

  const bankRows = await sql<{ id: string }[]>`
    insert into banks (name, status) values ('SimpleFX LP', 'active')
    on conflict (name) do update set status = 'active'
    returning id
  `
  const bankId = bankRows[0]?.id
  if (!bankId) return { error: 'Failed to resolve bank', status: 500 }

  return { lp, userId: lpUser.id, walletId: lpWallet.id, bankId, mainDb }
}
