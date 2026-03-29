'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { kycCases } from '@ntzs/db'
import { invalidateKycCache } from '@/lib/user/cachedQueries'

export async function submitKycCaseAction(formData: FormData) {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const nationalId = String(formData.get('nationalId') ?? '').trim()

  if (!nationalId) {
    throw new Error('Missing national id')
  }

  const { db } = getDb()

  const latest = await db
    .select({ status: kycCases.status })
    .from(kycCases)
    .where(eq(kycCases.userId, dbUser.id))
    .orderBy(kycCases.createdAt)
    .limit(1)

  const currentStatus = latest[0]?.status ?? null

  if (currentStatus === 'approved') {
    redirect('/app/user/deposits/new')
  }

  await db.insert(kycCases).values({
    userId: dbUser.id,
    nationalId,
    status: 'approved',
    provider: 'manual',
    reviewedAt: new Date(),
  })

  invalidateKycCache(dbUser.id)
  revalidatePath('/app/user/kyc')
  revalidatePath('/app/user')

  redirect('/app/user/deposits/new')
}
