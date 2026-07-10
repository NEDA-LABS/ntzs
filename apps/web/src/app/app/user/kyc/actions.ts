'use server'

import { desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { kycCases } from '@ntzs/db'
import { invalidateKycCache } from '@/lib/user/cachedQueries'
import { verifyNidaNumber } from '@/lib/kyc/selcom'

export interface NidaFormState {
  error: string | null
}

/**
 * Verify the user's NIDA via Selcom and record the outcome as a kyc_case.
 * Designed for useActionState: failures RETURN { error } (rendered inline)
 * instead of throwing — an uncaught throw in production renders Next's generic
 * "Application error" screen, which is how a failed verification used to crash
 * the whole page. Success redirects (default /app/user, where the layout
 * auto-provisions the wallet for a newly verified user).
 */
export async function verifyNidaAction(_prev: NidaFormState, formData: FormData): Promise<NidaFormState> {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const nationalId = String(formData.get('nationalId') ?? '').trim()
  const redirectToRaw = String(formData.get('redirectTo') ?? '/app/user')
  // Only same-app paths — never an absolute URL from form data.
  const redirectTo = redirectToRaw.startsWith('/') && !redirectToRaw.startsWith('//') ? redirectToRaw : '/app/user'

  if (!nationalId) {
    return { error: 'Enter your NIDA number.' }
  }

  const { db } = getDb()

  const latest = await db
    .select({ status: kycCases.status })
    .from(kycCases)
    .where(eq(kycCases.userId, dbUser.id))
    .orderBy(desc(kycCases.createdAt))
    .limit(1)

  if (latest[0]?.status === 'approved') {
    redirect(redirectTo)
  }

  const verification = await verifyNidaNumber(nationalId)

  if (verification.status === 'unavailable') {
    console.error('[kyc] verification unavailable:', verification.error)
    return { error: 'Identity verification is temporarily unavailable. Please try again shortly.' }
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
    return { error: verification.message || 'This NIDA number could not be verified. Check it and try again.' }
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

  redirect(redirectTo)
}
