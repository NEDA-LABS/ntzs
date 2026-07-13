'use server'

import { desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { kycCases } from '@ntzs/db'
import { invalidateKycCache } from '@/lib/user/cachedQueries'
import { normalizeNidaNumber, verifyNidaNumber } from '@/lib/kyc/selcom'
import { bindPhoneToNidaIdentity } from '@/lib/kyc/binding'
import { runIdentityLadder } from '@/lib/kyc/ladder'
import { isValidTanzanianPhone, normalizePhone } from '@/lib/psp'
import { users } from '@ntzs/db'
import { getCachedWallet } from '@/lib/user/cachedWallet'
import { DIRECT_APP_SIGNUP_PAUSED } from '@/lib/wallet-gating'

export interface NidaFormState {
  error: string | null
  /** Non-error outcome that keeps the user on the form (e.g. sent to manual review). */
  notice?: string | null
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
  const phoneInput = String(formData.get('phone') ?? '').trim()
  const redirectToRaw = String(formData.get('redirectTo') ?? '/app/user')
  // Only same-app paths — never an absolute URL from form data.
  const redirectTo = redirectToRaw.startsWith('/') && !redirectToRaw.startsWith('//') ? redirectToRaw : '/app/user'

  if (!nationalId) {
    return { error: 'Enter your NIDA number.' }
  }

  const normalized = normalizeNidaNumber(nationalId)
  if (!normalized) {
    return { error: 'A NIDA number is 20 digits — check it and try again.' }
  }

  if (!phoneInput || !isValidTanzanianPhone(phoneInput)) {
    return { error: 'Enter a valid Tanzanian mobile money number (07…).' }
  }

  const { db, sql: rawSql } = getDb()

  // Policy: one NIDA backs at most one direct-app wallet — 'pending' counts,
  // so a NIDA under review can't be claimed twice. (Partner-scoped uniqueness
  // is enforced separately in the WaaS routes.)
  const dupes = await rawSql<{ id: string }[]>`
    select kc.id
    from kyc_cases kc
    left join partner_users pu on pu.user_id = kc.user_id
    where kc.status in ('approved', 'pending')
      and kc.user_id != ${dbUser.id}
      and pu.user_id is null
      and regexp_replace(kc.national_id, '\\D', '', 'g') = ${normalized}
    limit 1
  `
  if (dupes.length) {
    return { error: 'This NIDA number is already linked to another nTZS account. Contact support if this is unexpected.' }
  }

  const latest = await db
    .select({ status: kycCases.status })
    .from(kycCases)
    .where(eq(kycCases.userId, dbUser.id))
    .orderBy(desc(kycCases.createdAt))
    .limit(1)

  if (latest[0]?.status === 'approved') {
    redirect(redirectTo)
  }

  if (latest[0]?.status === 'pending') {
    return {
      error: null,
      notice: 'Your identity verification is already under manual review — no need to resubmit. You will be able to continue once it completes.',
    }
  }

  // Pilot capacity gate (below the approved-user redirect so nobody already
  // through is blocked): while direct-app sign-ups are paused, a wallet-less
  // account is a new sign-up and cannot start verification here — this is the
  // server-side belt behind the sign-up page hand-off. Existing wallet
  // holders may still verify (retro-KYC of the live cohort).
  if (DIRECT_APP_SIGNUP_PAUSED) {
    const wallet = await getCachedWallet(dbUser.id)
    if (!wallet) {
      return {
        error: 'New sign-ups on this app are paused — create your account in the NEDApay app at app.nedapay.xyz.',
      }
    }
  }

  // Risk-tiered verification ladder (see lib/kyc/ladder.ts): Selcom pair
  // check (Tier A) → telco SIM-registration evidence (Tier B) → manual
  // review queue (Tier C). No outcome is a dead end.
  const verdict = await runIdentityLadder(
    { verifyPair: verifyNidaNumber, bindPhone: bindPhoneToNidaIdentity },
    { nidaNumber: normalized, phone: phoneInput }
  )

  if (verdict.outcome === 'unavailable') {
    console.error('[kyc] verification unavailable:', verdict.error)
    return { error: verdict.userMessage }
  }

  if (verdict.outcome === 'rejected') {
    await db.insert(kycCases).values({
      userId: dbUser.id,
      nationalId: normalized,
      status: 'rejected',
      provider: 'selcom_nida',
      reviewedAt: new Date(),
      reviewReason: verdict.evidence,
    })
    invalidateKycCache(dbUser.id)
    revalidatePath('/app/user/kyc')
    return { error: verdict.userMessage }
  }

  if (verdict.outcome === 'review') {
    // Tier C: park as 'pending' for maker-checker review in Backstage → KYC.
    await db.insert(kycCases).values({
      userId: dbUser.id,
      nationalId: normalized,
      status: 'pending',
      provider: 'selcom_nida',
      reviewReason: verdict.evidence,
    })
    await db.update(users).set({ phone: normalizePhone(phoneInput), updatedAt: new Date() }).where(eq(users.id, dbUser.id))
    invalidateKycCache(dbUser.id)
    revalidatePath('/app/user/kyc')
    return { error: null, notice: verdict.userMessage }
  }

  await db.insert(kycCases).values({
    userId: dbUser.id,
    nationalId: normalized,
    status: 'approved',
    provider: verdict.provider,
    providerReference: verdict.reference,
    reviewedAt: new Date(),
    reviewReason: verdict.evidence,
  })

  await db.update(users).set({ phone: normalizePhone(phoneInput), updatedAt: new Date() }).where(eq(users.id, dbUser.id))

  invalidateKycCache(dbUser.id)
  revalidatePath('/app/user/kyc')
  revalidatePath('/app/user')

  redirect(redirectTo)
}
