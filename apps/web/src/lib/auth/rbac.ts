import { eq } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { syncNeonAuthUser } from '@/lib/user/syncNeonAuthUser'
import { users } from '@ntzs/db'

export type UserRole = 'end_user' | 'bank_admin' | 'platform_compliance' | 'super_admin'

export async function getCurrentDbUser() {
  const dbUser = await syncNeonAuthUser()
  return dbUser
}

export async function requireDbUser() {
  const dbUser = await getCurrentDbUser()

  if (!dbUser) {
    throw new Error('Unauthorized')
  }

  return dbUser
}

export async function requireAnyRole(roles: UserRole[]) {
  const dbUser = await requireDbUser()

  if (!roles.includes(dbUser.role as UserRole)) {
    throw new Error('Forbidden')
  }

  return dbUser
}

export async function requireRole(role: UserRole) {
  return requireAnyRole([role])
}

export async function setUserRoleByEmail(email: string, role: UserRole) {
  const { db } = getDb()

  const updated = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.email, email))
    .returning()

  return updated[0] ?? null
}
