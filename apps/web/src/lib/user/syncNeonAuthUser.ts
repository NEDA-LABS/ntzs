import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { neonAuth } from '@neondatabase/neon-js/auth/next'

import { getDb } from '@/lib/db'
import { users } from '@ntzs/db'

export const syncNeonAuthUser = cache(async function syncNeonAuthUser() {
  const { user } = await neonAuth()

  if (!user) {
    return null
  }

  const userEmailNormalized = user.email?.trim().toLowerCase() ?? null
  const userEmailToStore = userEmailNormalized ?? `${user.id}@unknown.local`
  const bootstrapEmailList = (process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  const shouldBootstrapSuperAdmin =
    Boolean(userEmailNormalized) && bootstrapEmailList.includes(userEmailNormalized)

  const { db } = getDb()

  // Try to find by neon auth user id first.
  const existing = await db.query.users.findFirst({
    where: eq(users.neonAuthUserId, user.id),
  })

  if (existing) {
    if (shouldBootstrapSuperAdmin && existing.role !== 'super_admin') {
      const updated = await db
        .update(users)
        .set({ role: 'super_admin', updatedAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning()

      return updated[0] ?? existing
    }

    return existing
  }

  // Fallback: if the user already exists by email, attach neon auth id.
  // (This handles edge cases where you imported users before enabling Neon Auth.)
  if (userEmailNormalized) {
    const byEmail = await db.query.users.findFirst({
      where: eq(users.email, userEmailNormalized),
    })

    if (byEmail) {
      const setData: Partial<typeof users.$inferInsert> = {
        neonAuthUserId: user.id,
        updatedAt: new Date(),
      }

      if (shouldBootstrapSuperAdmin && byEmail.role !== 'super_admin') {
        setData.role = 'super_admin'
      }

      const updated = await db
        .update(users)
        .set(setData)
        .where(eq(users.id, byEmail.id))
        .returning()

      return updated[0] ?? byEmail
    }
  }

  const inserted = await db
    .insert(users)
    .values({
      neonAuthUserId: user.id,
      email: userEmailToStore,
      role: shouldBootstrapSuperAdmin ? 'super_admin' : undefined,
    })
    .onConflictDoNothing()
    .returning()

  if (inserted[0]) {
    return inserted[0]
  }

  // If we got here, another request likely inserted the user in parallel.
  // Re-fetch and ensure the Neon Auth user id is attached.
  const existingAfter = await db.query.users.findFirst({
    where: eq(users.neonAuthUserId, user.id),
  })

  if (existingAfter) {
    if (shouldBootstrapSuperAdmin && existingAfter.role !== 'super_admin') {
      const updated = await db
        .update(users)
        .set({ role: 'super_admin', updatedAt: new Date() })
        .where(eq(users.id, existingAfter.id))
        .returning()

      return updated[0] ?? existingAfter
    }

    return existingAfter
  }

  if (userEmailNormalized) {
    const byEmailAfter = await db.query.users.findFirst({
      where: eq(users.email, userEmailNormalized),
    })

    if (byEmailAfter) {
      const setData: Partial<typeof users.$inferInsert> = {
        neonAuthUserId: user.id,
        updatedAt: new Date(),
      }

      if (shouldBootstrapSuperAdmin && byEmailAfter.role !== 'super_admin') {
        setData.role = 'super_admin'
      }

      const updated = await db
        .update(users)
        .set(setData)
        .where(eq(users.id, byEmailAfter.id))
        .returning()

      return updated[0] ?? byEmailAfter
    }
  }

  return null
})
