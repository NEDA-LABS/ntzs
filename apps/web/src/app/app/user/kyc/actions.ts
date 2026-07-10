'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { kycCases } from '@ntzs/db'
import { invalidateKycCache } from '@/lib/user/cachedQueries'
import { verifyNidaNumber } from '@/lib/kyc/selcom'

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

  // Real identity verification via Selcom (NIDA lookup) — BoT Parameter 8.
  // The previous implementation approved any string with no verification at
  // all; nothing is approved anymore without a positive NIDA match.
  const verification = await verifyNidaNumber(nationalId)

  if (verification.status === 'unavailable') {
    console.error('[kyc] verification unavailable:', verification.error)
    throw new Error('Identity verification is temporarily unavailable. Please try again shortly.')
  }

  if (verification.status === 'not_found') {
    await db.insert(kycCases).values({
      userId: dbUser.id,
      nationalId,
      status: 'rejected',
      provider: 'selcom_nida',
      reviewedAt: new Date(),
      reviewReason: verification.message || 'NIDA number could not be verified',
    })
    invalidateKycCache(dbUser.id)
    revalidatePath('/app/user/kyc')
    throw new Error(verification.message || 'This NIDA number could not be verified. Check it and try again.')
  }

  await db.insert(kycCases).values({
    userId: dbUser.id,
    nationalId,
    status: 'approved',
    provider: 'selcom_nida',
    providerReference: verification.reference,
    reviewedAt: new Date(),
    reviewReason: verification.fullName ? `NIDA holder: ${verification.fullName}` : 'NIDA verified via Selcom Identity',
  })

  invalidateKycCache(dbUser.id)
  revalidatePath('/app/user/kyc')
  revalidatePath('/app/user')

  redirect('/app/user/deposits/new')
}
