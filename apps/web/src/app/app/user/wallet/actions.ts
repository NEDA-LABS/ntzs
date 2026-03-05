'use server'

import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { wallets, users } from '@ntzs/db'

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

  revalidatePath('/app/user')
  revalidatePath('/app/user/wallet')
}
