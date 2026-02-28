import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { kycCases } from '@ntzs/db'

import { GlassPanel } from '../../_components/GlassPanel'
import { formatDateTimeEAT } from '@/lib/format-date'
import { submitKycCaseAction } from './actions'

export default async function KycPage() {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const { db } = getDb()

  const latest = await db
    .select({
      status: kycCases.status,
      nationalId: kycCases.nationalId,
      createdAt: kycCases.createdAt,
    })
    .from(kycCases)
    .where(eq(kycCases.userId, dbUser.id))
    .orderBy(desc(kycCases.createdAt))
    .limit(1)

  const current = latest[0] ?? null

  return (
    <main className="flex flex-col gap-6">
      <GlassPanel
        title="Identity verification"
        description="Submit your national ID so we can complete required checks before enabling deposits."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/60">Current status</div>
            <div className="mt-2 text-sm font-semibold">{current?.status ?? 'Not started'}</div>
            <div className="mt-2 text-sm text-white/70">
              {current?.createdAt ? formatDateTimeEAT(current.createdAt) : ''}
            </div>
            <div className="mt-2 text-xs text-white/60">{current?.nationalId ? `ID: ${current.nationalId}` : ''}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-semibold">Submit details</div>
            <p className="mt-2 text-sm text-white/70">
              Upload will be enabled next. For now, enter your national ID number.
            </p>

            <form action={submitKycCaseAction} className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-2">
                <span className="text-sm text-white/70">National ID</span>
                <input
                  name="nationalId"
                  required
                  className="h-11 rounded-xl border border-white/10 bg-black/30 px-4 text-white outline-none"
                />
              </label>

              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90"
              >
                Submit
              </button>
            </form>
          </div>
        </div>

        <div className="mt-6">
          <Link href="/app/user" className="text-sm text-white underline underline-offset-4">
            Back to dashboard
          </Link>
        </div>
      </GlassPanel>
    </main>
  )
}
