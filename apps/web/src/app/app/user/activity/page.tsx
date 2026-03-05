import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { burnRequests, depositRequests, kycCases } from '@ntzs/db'
import { getCachedWallet } from '@/lib/user/cachedWallet'

import { GlassPanel } from '../../_components/GlassPanel'
import { formatDateTimeEAT } from '@/lib/format-date'

export default async function ActivityPage() {
  const dbUser = await requireAnyRole(['end_user', 'super_admin'])
  const { db } = getDb()

  // Run all queries in parallel instead of sequentially
  const [wallet, latestKyc, deposits, burns] = await Promise.all([
    getCachedWallet(dbUser.id),
    db
      .select({ status: kycCases.status, createdAt: kycCases.createdAt })
      .from(kycCases)
      .where(eq(kycCases.userId, dbUser.id))
      .orderBy(desc(kycCases.createdAt))
      .limit(1),
    db
      .select({
        id: depositRequests.id,
        amountTzs: depositRequests.amountTzs,
        status: depositRequests.status,
        createdAt: depositRequests.createdAt,
      })
      .from(depositRequests)
      .where(eq(depositRequests.userId, dbUser.id))
      .orderBy(desc(depositRequests.createdAt))
      .limit(50),
    db
      .select({
        id: burnRequests.id,
        amountTzs: burnRequests.amountTzs,
        status: burnRequests.status,
        createdAt: burnRequests.createdAt,
      })
      .from(burnRequests)
      .where(eq(burnRequests.userId, dbUser.id))
      .orderBy(desc(burnRequests.createdAt))
      .limit(50),
  ])

  const txns = [
    ...deposits.map((d) => ({
      type: 'deposit' as const,
      id: d.id,
      amountTzs: d.amountTzs,
      status: d.status,
      createdAt: d.createdAt,
    })),
    ...burns.map((b) => ({
      type: 'burn' as const,
      id: b.id,
      amountTzs: b.amountTzs,
      status: b.status,
      createdAt: b.createdAt,
    })),
  ]
    .filter((t) => t.createdAt)
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
    .slice(0, 50)

  return (
    <main className="flex flex-col gap-6">
      <GlassPanel title="Activity" description="Review your wallet setup and deposit history.">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/60">Wallet</div>
            <div className="mt-2 text-sm font-semibold">{wallet ? 'Connected' : 'Not set'}</div>
            <div className="mt-2 break-all font-mono text-xs text-white/60">
              {wallet?.address ?? '—'}
            </div>
            <div className="mt-3">
              <Link href="/app/user/wallet" className="text-sm text-white underline underline-offset-4">
                Manage wallet
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/60">Identity check</div>
            <div className="mt-2 text-sm font-semibold">{latestKyc[0]?.status ?? 'Not started'}</div>
            <div className="mt-3">
              <Link href="/app/user/kyc" className="text-sm text-white underline underline-offset-4">
                View status
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/60">Deposits</div>
            <div className="mt-2 text-sm font-semibold">{deposits.length}</div>
            <div className="mt-3">
              <Link href="/app/user/deposits/new" className="text-sm text-white underline underline-offset-4">
                Create a deposit
              </Link>
            </div>
          </div>
        </div>
      </GlassPanel>

      <GlassPanel title="Transaction history">
        {txns.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-white/60">
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Amount (TZS)</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-b border-white/10">
                    <td className="py-2 pr-4">{formatDateTimeEAT(t.createdAt)}</td>
                    <td className="py-2 pr-4">{t.type === 'deposit' ? 'Deposit' : 'Withdraw'}</td>
                    <td className="py-2 pr-4">{t.type === 'deposit' ? t.amountTzs : -t.amountTzs}</td>
                    <td className="py-2 pr-4">{String(t.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
            No transactions yet.
          </div>
        )}
      </GlassPanel>
    </main>
  )
}
