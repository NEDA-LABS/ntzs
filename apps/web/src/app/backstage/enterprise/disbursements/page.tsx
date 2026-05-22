import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseDisbursementBatches } from '@ntzs/db'
import { eq, inArray, desc } from 'drizzle-orm'
import { requireAnyRole } from '@/lib/auth/rbac'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ApproveButton } from './_components/ApproveButton'

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function BackstageDisbursementsPage() {
  try { await requireAnyRole(['super_admin', 'platform_compliance']) } catch {
    redirect('/backstage')
  }

  const batches = await db
    .select({
      id: enterpriseDisbursementBatches.id,
      enterpriseId: enterpriseDisbursementBatches.enterpriseId,
      filename: enterpriseDisbursementBatches.filename,
      totalAmountTzs: enterpriseDisbursementBatches.totalAmountTzs,
      serviceFeeTzs: enterpriseDisbursementBatches.serviceFeeTzs,
      contractorCount: enterpriseDisbursementBatches.contractorCount,
      status: enterpriseDisbursementBatches.status,
      createdAt: enterpriseDisbursementBatches.createdAt,
    })
    .from(enterpriseDisbursementBatches)
    .where(inArray(enterpriseDisbursementBatches.status, ['awaiting_funds', 'pending_review']))
    .orderBy(desc(enterpriseDisbursementBatches.createdAt))
    .limit(100)

  const enterpriseIds = [...new Set(batches.map(b => b.enterpriseId))]
  const accounts = enterpriseIds.length > 0
    ? await db
        .select({ id: enterpriseAccounts.id, name: enterpriseAccounts.name, email: enterpriseAccounts.email })
        .from(enterpriseAccounts)
        .where(inArray(enterpriseAccounts.id, enterpriseIds))
    : []

  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a]))

  return (
    <div className="p-10 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Pending Disbursements</h1>
        <p className="text-sm text-zinc-400 mt-1">{batches.length} batch{batches.length !== 1 ? 'es' : ''} awaiting action</p>
      </div>

      {batches.length === 0 ? (
        <div className="border border-white/10 rounded-xl p-12 text-center">
          <p className="text-sm text-zinc-600">No disbursement batches pending approval.</p>
        </div>
      ) : (
        <div className="border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-xs text-zinc-500 uppercase tracking-wider">
                <th className="px-5 py-3 text-left">Client</th>
                <th className="px-5 py-3 text-left">Batch</th>
                <th className="px-5 py-3 text-left">Date</th>
                <th className="px-5 py-3 text-right">Contractors</th>
                <th className="px-5 py-3 text-right">Total Due (TZS)</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => {
                const acc = accountMap[b.enterpriseId]
                return (
                  <tr key={b.id} className={`border-b border-white/5 ${i % 2 === 0 ? 'bg-black' : 'bg-zinc-950'}`}>
                    <td className="px-5 py-3 text-white font-medium">{acc?.name ?? acc?.email ?? '—'}</td>
                    <td className="px-5 py-3 text-zinc-400 font-mono text-xs">{b.filename ?? b.id.slice(0, 8)}</td>
                    <td className="px-5 py-3 text-zinc-500 text-xs">{fmtDate(b.createdAt)}</td>
                    <td className="px-5 py-3 text-right text-zinc-300">{b.contractorCount}</td>
                    <td className="px-5 py-3 text-right text-white tabular-nums">
                      {fmt(b.totalAmountTzs + b.serviceFeeTzs)}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border ${
                        b.status === 'awaiting_funds'
                          ? 'text-sky-400 bg-sky-950 border-sky-900'
                          : 'text-amber-400 bg-amber-950 border-amber-900'
                      }`}>
                        {b.status === 'awaiting_funds' ? 'Awaiting Funds' : 'Pending Review'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {b.status === 'awaiting_funds' && (
                          <ApproveButton batchId={b.id} />
                        )}
                        <Link
                          href={`/enterprise/dashboard/disbursements/${b.id}`}
                          target="_blank"
                          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
