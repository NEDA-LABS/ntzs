import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { kycCases } from '@ntzs/db'

import { GlassPanel } from '../../_components/GlassPanel'
import { formatDateTimeEAT } from '@/lib/format-date'
import { submitKycCaseAction } from './actions'
import { GlassCard } from '@/components/ui/glass-card'
import { GlassInput } from '@/components/ui/glass-input'

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
          <GlassCard innerClassName="p-4">
            <div className="text-xs text-muted-foreground">Current status</div>
            <div className="mt-2 text-sm font-semibold text-foreground">{current?.status ?? 'Not started'}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              {current?.createdAt ? formatDateTimeEAT(current.createdAt) : ''}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{current?.nationalId ? `ID: ${current.nationalId}` : ''}</div>
          </GlassCard>

          <GlassCard innerClassName="p-4">
            <div className="text-sm font-semibold text-foreground">Submit details</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Upload will be enabled next. For now, enter your national ID number.
            </p>

            <form action={submitKycCaseAction} className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-2">
                <span className="text-sm text-muted-foreground">National ID</span>
                <GlassInput name="nationalId" required className="h-11" />
              </label>

              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus:ring-2 focus:ring-ring"
              >
                Submit
              </button>
            </form>
          </GlassCard>
        </div>

        <div className="mt-6">
          <Link href="/app/user" className="rounded-sm text-sm text-primary underline underline-offset-4 focus-visible:outline-none focus:ring-2 focus:ring-ring">
            Back to dashboard
          </Link>
        </div>
      </GlassPanel>
    </main>
  )
}
