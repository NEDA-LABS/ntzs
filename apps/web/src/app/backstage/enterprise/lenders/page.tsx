import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, merchantAccounts, enterpriseLoanAgreements, partners } from '@ntzs/db'
import { eq, and, desc } from 'drizzle-orm'
import { requireAnyRole } from '@/lib/auth/rbac'
import { redirect } from 'next/navigation'
import Link from 'next/link'

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

export default async function BackstageLendersPage() {
  try { await requireAnyRole(['super_admin', 'platform_compliance']) } catch {
    redirect('/backstage')
  }

  const lenders = await db
    .select({
      id: enterpriseAccounts.id,
      name: enterpriseAccounts.name,
      email: enterpriseAccounts.email,
      isActive: enterpriseAccounts.isActive,
      partnerId: enterpriseAccounts.partnerId,
      partnerName: partners.name,
      createdAt: enterpriseAccounts.createdAt,
    })
    .from(enterpriseAccounts)
    .leftJoin(partners, eq(enterpriseAccounts.partnerId, partners.id))
    .where(eq(enterpriseAccounts.type, 'capital_lender'))
    .orderBy(desc(enterpriseAccounts.createdAt))

  // For each lender with a partner, fetch their linked merchants + loan summaries
  const lenderDetails = await Promise.all(
    lenders.map(async (lender) => {
      if (!lender.partnerId) return { ...lender, merchants: [], totalPrincipal: 0, totalRepaid: 0 }

      const merchants = await db
        .select({
          id: merchantAccounts.id,
          businessName: merchantAccounts.businessName,
          handle: merchantAccounts.handle,
          lenderSplitPct: merchantAccounts.lenderSplitPct,
          principalTzs: enterpriseLoanAgreements.principalTzs,
          repaidTzs: enterpriseLoanAgreements.repaidTzs,
          loanStatus: enterpriseLoanAgreements.status,
        })
        .from(merchantAccounts)
        .leftJoin(
          enterpriseLoanAgreements,
          and(
            eq(enterpriseLoanAgreements.merchantId, merchantAccounts.id),
            eq(enterpriseLoanAgreements.partnerId, lender.partnerId!)
          )
        )
        .where(eq(merchantAccounts.lenderPartnerId, lender.partnerId!))

      const totalPrincipal = merchants.reduce((s, m) => s + (m.principalTzs ?? 0), 0)
      const totalRepaid = merchants.reduce((s, m) => s + (m.repaidTzs ?? 0), 0)

      return { ...lender, merchants, totalPrincipal, totalRepaid }
    })
  )

  return (
    <div className="p-10 space-y-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Capital Lenders</h1>
          <p className="text-sm text-zinc-400 mt-1">{lenders.length} lender account{lenders.length !== 1 ? 's' : ''}</p>
        </div>
        <Link
          href="/backstage/enterprise"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ← All enterprise accounts
        </Link>
      </div>

      {lenders.length === 0 ? (
        <div className="border border-white/10 rounded-xl p-12 text-center">
          <p className="text-sm text-zinc-600">No capital lender accounts yet. They sign up at /enterprise/signup.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {lenderDetails.map(lender => (
            <div key={lender.id} className="border border-white/10 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 bg-zinc-900 border-b border-white/10">
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">{lender.name ?? lender.email}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {lender.email}
                      {lender.partnerName && <span className="ml-2 text-indigo-400">· {lender.partnerName}</span>}
                    </p>
                  </div>
                  {!lender.isActive && (
                    <span className="text-[9px] tracking-wider uppercase px-2 py-0.5 border text-amber-400 bg-amber-950 border-amber-900">
                      Pending Approval
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-6 text-right">
                  {lender.merchants.length > 0 && (
                    <>
                      <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">Principal</p>
                        <p className="text-sm text-white">TZS {fmt(lender.totalPrincipal)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">Repaid</p>
                        <p className="text-sm text-emerald-400">TZS {fmt(lender.totalRepaid)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">Outstanding</p>
                        <p className="text-sm text-indigo-400">TZS {fmt(lender.totalPrincipal - lender.totalRepaid)}</p>
                      </div>
                    </>
                  )}
                  <Link
                    href={`/backstage/enterprise/${lender.id}`}
                    className="text-xs text-zinc-500 hover:text-white transition-colors ml-2"
                  >
                    Manage →
                  </Link>
                </div>
              </div>

              {lender.merchants.length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/5 text-[10px] text-zinc-600 uppercase tracking-wider bg-black">
                      <th className="px-5 py-2.5 text-left">Merchant</th>
                      <th className="px-5 py-2.5 text-right">Split %</th>
                      <th className="px-5 py-2.5 text-right">Principal (TZS)</th>
                      <th className="px-5 py-2.5 text-right">Repaid (TZS)</th>
                      <th className="px-5 py-2.5 text-right">Outstanding (TZS)</th>
                      <th className="px-5 py-2.5 text-left">Loan Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lender.merchants.map((m, i) => (
                      <tr key={m.id} className={`border-b border-white/5 last:border-0 ${i % 2 === 0 ? 'bg-zinc-950' : 'bg-black'}`}>
                        <td className="px-5 py-3 text-zinc-300">{m.businessName ?? m.handle}</td>
                        <td className="px-5 py-3 text-right text-indigo-400">{m.lenderSplitPct}%</td>
                        <td className="px-5 py-3 text-right text-zinc-400 tabular-nums">
                          {m.principalTzs != null ? fmt(m.principalTzs) : '—'}
                        </td>
                        <td className="px-5 py-3 text-right text-emerald-400 tabular-nums">
                          {m.repaidTzs != null ? fmt(m.repaidTzs) : '—'}
                        </td>
                        <td className="px-5 py-3 text-right text-zinc-300 tabular-nums">
                          {m.principalTzs != null ? fmt((m.principalTzs ?? 0) - (m.repaidTzs ?? 0)) : '—'}
                        </td>
                        <td className="px-5 py-3">
                          {m.loanStatus ? (
                            <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border ${
                              m.loanStatus === 'repaid'
                                ? 'text-emerald-400 bg-emerald-950 border-emerald-900'
                                : m.loanStatus === 'active'
                                ? 'text-indigo-400 bg-indigo-950 border-indigo-900'
                                : 'text-zinc-500 border-zinc-800'
                            }`}>
                              {m.loanStatus}
                            </span>
                          ) : <span className="text-zinc-600">no agreement</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="px-5 py-4 bg-black">
                  <p className="text-xs text-zinc-600">
                    No merchants linked yet.{' '}
                    <Link href={`/backstage/enterprise/${lender.id}`} className="text-indigo-400 hover:text-indigo-300">
                      Link merchants →
                    </Link>
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
