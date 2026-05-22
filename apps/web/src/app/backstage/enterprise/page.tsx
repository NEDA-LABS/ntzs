import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, partners } from '@ntzs/db'
import { eq, desc } from 'drizzle-orm'
import { requireAnyRole } from '@/lib/auth/rbac'
import { redirect } from 'next/navigation'
import Link from 'next/link'

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function BackstageEnterprisePage() {
  try { await requireAnyRole(['super_admin', 'platform_compliance']) } catch {
    redirect('/backstage')
  }

  const accounts = await db
    .select({
      id: enterpriseAccounts.id,
      name: enterpriseAccounts.name,
      email: enterpriseAccounts.email,
      type: enterpriseAccounts.type,
      isActive: enterpriseAccounts.isActive,
      partnerId: enterpriseAccounts.partnerId,
      partnerName: partners.name,
      createdAt: enterpriseAccounts.createdAt,
    })
    .from(enterpriseAccounts)
    .leftJoin(partners, eq(enterpriseAccounts.partnerId, partners.id))
    .orderBy(desc(enterpriseAccounts.createdAt))
    .limit(200)

  const pending = accounts.filter(a => !a.isActive)
  const active = accounts.filter(a => a.isActive)

  return (
    <div className="p-10 space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-white">Enterprise Accounts</h1>
        <p className="text-sm text-zinc-400 mt-1">{pending.length} pending approval · {active.length} active</p>
      </div>

      {pending.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-amber-400 uppercase tracking-widest mb-4">Pending Approval</h2>
          <div className="border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5 text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left">Org</th>
                  <th className="px-5 py-3 text-left">Email</th>
                  <th className="px-5 py-3 text-left">Type</th>
                  <th className="px-5 py-3 text-left">Signed Up</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {pending.map((a, i) => (
                  <tr key={a.id} className={`border-b border-white/5 ${i % 2 === 0 ? 'bg-black' : 'bg-zinc-950'}`}>
                    <td className="px-5 py-3 text-white font-medium">{a.name ?? '—'}</td>
                    <td className="px-5 py-3 text-zinc-400">{a.email}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border ${
                        a.type === 'capital_lender'
                          ? 'text-indigo-400 bg-indigo-950 border-indigo-900'
                          : 'text-sky-400 bg-sky-950 border-sky-900'
                      }`}>
                        {a.type === 'capital_lender' ? 'Capital Lender' : 'Disbursement Client'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-zinc-500 text-xs">{fmtDate(a.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/backstage/enterprise/${a.id}`}
                        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        Review →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-widest mb-4">Active Accounts</h2>
        {active.length === 0 ? (
          <p className="text-sm text-zinc-600">No active enterprise accounts yet.</p>
        ) : (
          <div className="border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5 text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left">Org</th>
                  <th className="px-5 py-3 text-left">Email</th>
                  <th className="px-5 py-3 text-left">Type</th>
                  <th className="px-5 py-3 text-left">Partner</th>
                  <th className="px-5 py-3 text-left">Joined</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {active.map((a, i) => (
                  <tr key={a.id} className={`border-b border-white/5 ${i % 2 === 0 ? 'bg-black' : 'bg-zinc-950'}`}>
                    <td className="px-5 py-3 text-white font-medium">{a.name ?? '—'}</td>
                    <td className="px-5 py-3 text-zinc-400">{a.email}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border ${
                        a.type === 'capital_lender'
                          ? 'text-indigo-400 bg-indigo-950 border-indigo-900'
                          : 'text-sky-400 bg-sky-950 border-sky-900'
                      }`}>
                        {a.type === 'capital_lender' ? 'Lender' : 'Disbursement'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-zinc-500 text-xs">{a.partnerName ?? <span className="text-amber-500">not linked</span>}</td>
                    <td className="px-5 py-3 text-zinc-500 text-xs">{fmtDate(a.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/backstage/enterprise/${a.id}`}
                        className="text-xs text-zinc-400 hover:text-white transition-colors"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
