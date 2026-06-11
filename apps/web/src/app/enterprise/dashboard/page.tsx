'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { RepaymentTrendChart, AgingBar } from './_components/charts'

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

interface LenderData {
  merchants: Array<{
    id: string
    businessName: string | null
    handle: string
    lenderSplitPct: number
    loanStatus: string | null
    principalTzs: number | null
    repaidTzs: number | null
  }>
  treasuryBalanceTzs: number
  totalPrincipalTzs: number
  totalRepaidTzs: number
  activeLoanCount: number
}

interface AnalyticsData {
  yield: { blendedYieldPct: number; interestContractedTzs: number; interestRealizedTzs: number }
  capital: { totalPrincipalTzs: number; totalDisbursedTzs: number; capitalOutstandingTzs: number; totalRepaidTzs: number; utilizationPct: number; recoveryPct: number }
  risk: { aging: { current: number; dueSoon: number; overdue: number; severelyOverdue: number }; atRiskTzs: number; overdueLoanCount: number; activeLoanCount: number }
  repaymentTrend: Array<{ month: string; totalTzs: number; count: number }>
}

interface DisbursementData {
  recentBatches: Array<{
    id: string
    totalAmountTzs: number
    contractorCount: number
    status: string
    createdAt: string
  }>
  totalDisbursedTzs: number
  batchCount: number
  pendingBatchCount: number
}

export default function EnterpriseDashboardPage() {
  const [accountType, setAccountType] = useState<'capital_lender' | 'disbursement_client' | null>(null)
  const [lender, setLender] = useState<LenderData | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [disbursement, setDisbursement] = useState<DisbursementData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const me = await fetch('/enterprise/api/auth/me').then(r => r.json())
      setAccountType(me.type)

      if (me.type === 'capital_lender') {
        const [merchantsRes, balanceRes, analyticsRes] = await Promise.all([
          fetch('/enterprise/api/lender/merchants').then(r => r.json()),
          fetch('/enterprise/api/lender/treasury-balance').then(r => r.json()),
          fetch('/enterprise/api/lender/analytics').then(r => r.ok ? r.json() : null).catch(() => null),
        ])
        const merchants = merchantsRes.merchants ?? []
        const totalPrincipalTzs = merchants.reduce((s: number, m: LenderData['merchants'][0]) => s + (m.principalTzs ?? 0), 0)
        const totalRepaidTzs = merchants.reduce((s: number, m: LenderData['merchants'][0]) => s + (m.repaidTzs ?? 0), 0)
        const activeLoanCount = merchants.filter((m: LenderData['merchants'][0]) => m.loanStatus === 'active').length
        setLender({ merchants, treasuryBalanceTzs: balanceRes.balanceTzs ?? 0, totalPrincipalTzs, totalRepaidTzs, activeLoanCount })
        if (analyticsRes) setAnalytics(analyticsRes)
      }

      if (me.type === 'disbursement_client') {
        const batchesRes = await fetch('/enterprise/api/disbursements').then(r => r.json())
        const batches = batchesRes.batches ?? []
        const totalDisbursedTzs = batches
          .filter((b: DisbursementData['recentBatches'][0]) => b.status === 'completed')
          .reduce((s: number, b: DisbursementData['recentBatches'][0]) => s + b.totalAmountTzs, 0)
        const pendingBatchCount = batches.filter((b: DisbursementData['recentBatches'][0]) =>
          ['pending_review', 'awaiting_funds', 'approved', 'processing'].includes(b.status)
        ).length
        setDisbursement({ recentBatches: batches.slice(0, 5), totalDisbursedTzs, batchCount: batches.length, pendingBatchCount })
      }

      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="p-10">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-32 bg-gray-200 rounded" />
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded" />)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-10 space-y-10">
      <div>
        <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-1">Overview</p>
        <h1 className="text-2xl font-light text-gray-900">Dashboard</h1>
      </div>

      {accountType === 'capital_lender' && lender && (
        <>
          {analytics && (() => {
            const stillDrawable = Math.max(0, analytics.capital.totalPrincipalTzs - analytics.capital.capitalOutstandingTzs)
            if (stillDrawable <= 0 || lender.treasuryBalanceTzs >= stillDrawable) return null
            return (
              <div className="border border-amber-200 bg-amber-50 rounded-lg px-5 py-4 flex items-start gap-3">
                <span className="text-amber-500 mt-0.5">⚠</span>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-amber-800">Treasury below approved facilities</p>
                  <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                    Your treasury holds <strong>TZS {fmt(lender.treasuryBalanceTzs)}</strong>, but your merchants can still draw up to <strong>TZS {fmt(stillDrawable)}</strong>. Disbursements are funded directly from your treasury — top it up or some draws may be declined.
                  </p>
                  <Link href="/enterprise/dashboard/wallet" className="text-[11px] font-medium text-amber-800 underline mt-1.5 inline-block">Fund treasury →</Link>
                </div>
              </div>
            )
          })()}

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              { label: 'Treasury Balance', value: `TZS ${fmt(lender.treasuryBalanceTzs)}`, sub: 'available to lend', accent: 'indigo' },
              { label: 'Total Capital Deployed', value: `TZS ${fmt(lender.totalPrincipalTzs)}`, sub: 'across all merchants', accent: 'slate' },
              { label: 'Total Repaid', value: `TZS ${fmt(lender.totalRepaidTzs)}`, sub: `${lender.totalPrincipalTzs > 0 ? Math.round(lender.totalRepaidTzs / lender.totalPrincipalTzs * 100) : 0}% recovered`, accent: 'green' },
              { label: 'Active Loans', value: String(lender.activeLoanCount), sub: 'merchants funded', accent: 'slate' },
            ].map(card => (
              <div key={card.label} className="border border-gray-200 bg-white rounded-lg shadow-sm p-5">
                <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-3">{card.label}</p>
                <p className={`text-xl font-semibold ${card.accent === 'indigo' ? 'text-indigo-600' : card.accent === 'green' ? 'text-emerald-600' : 'text-gray-900'}`}>{card.value}</p>
                <p className="text-[10px] text-gray-400 mt-1">{card.sub}</p>
              </div>
            ))}
          </div>

          {analytics && (
            <>
              {/* Lending analytics */}
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  { label: 'Blended Yield', value: `${analytics.yield.blendedYieldPct.toFixed(1)}%`, sub: `TZS ${fmt(analytics.yield.interestRealizedTzs)} earned of ${fmt(analytics.yield.interestContractedTzs)}`, accent: 'indigo' },
                  { label: 'Facility Utilization', value: `${analytics.capital.utilizationPct.toFixed(0)}%`, sub: `TZS ${fmt(analytics.capital.totalDisbursedTzs)} drawn of ${fmt(analytics.capital.totalPrincipalTzs)}`, accent: 'slate' },
                  { label: 'Capital Outstanding', value: `TZS ${fmt(analytics.capital.capitalOutstandingTzs)}`, sub: 'cash still deployed', accent: 'slate' },
                  { label: 'At-Risk Capital', value: `TZS ${fmt(analytics.risk.atRiskTzs)}`, sub: `${analytics.risk.overdueLoanCount} loan${analytics.risk.overdueLoanCount === 1 ? '' : 's'} overdue`, accent: analytics.risk.atRiskTzs > 0 ? 'red' : 'green' },
                ].map(card => (
                  <div key={card.label} className="border border-gray-200 bg-white rounded-lg shadow-sm p-5">
                    <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-3">{card.label}</p>
                    <p className={`text-xl font-semibold ${card.accent === 'indigo' ? 'text-indigo-600' : card.accent === 'red' ? 'text-red-600' : card.accent === 'green' ? 'text-emerald-600' : 'text-gray-900'}`}>{card.value}</p>
                    <p className="text-[10px] text-gray-400 mt-1">{card.sub}</p>
                  </div>
                ))}
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                <div className="border border-gray-200 bg-white rounded-lg shadow-sm p-6">
                  <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-4">Capital at Risk · Aging</p>
                  <AgingBar aging={analytics.risk.aging} />
                </div>
                <div className="border border-gray-200 bg-white rounded-lg shadow-sm p-6">
                  <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-4">Repayment Inflow · 12 mo</p>
                  <RepaymentTrendChart data={analytics.repaymentTrend} />
                </div>
              </div>
            </>
          )}

          <div className="border border-gray-200 bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <p className="text-[10px] tracking-widest text-gray-400 uppercase">Merchant Portfolio</p>
              <Link href="/enterprise/dashboard/merchants" className="text-[10px] tracking-widest text-indigo-600 uppercase hover:text-indigo-700 transition-colors">View all →</Link>
            </div>
            {lender.merchants.length === 0 ? (
              <p className="px-6 py-8 text-xs text-gray-400">No merchants linked yet. Contact NEDApay to link merchants to your account.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {lender.merchants.slice(0, 6).map(m => {
                  const pct = m.principalTzs && m.principalTzs > 0 ? Math.round((m.repaidTzs ?? 0) / m.principalTzs * 100) : 0
                  return (
                    <div key={m.id} className="px-6 py-4 flex items-center gap-6 hover:bg-gray-50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{m.businessName ?? m.handle}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Split: <span className="text-indigo-600">{m.lenderSplitPct}%</span> to you</p>
                      </div>
                      <div className="w-40">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-gray-400">{pct}% repaid</span>
                          {m.loanStatus === 'repaid' && <span className="text-[9px] text-emerald-600 tracking-wider uppercase">Repaid</span>}
                        </div>
                        <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {accountType === 'disbursement_client' && disbursement && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              { label: 'Total Disbursed', value: `TZS ${fmt(disbursement.totalDisbursedTzs)}`, sub: 'all-time completed', accent: 'indigo' },
              { label: 'Total Batches', value: String(disbursement.batchCount), sub: 'payment runs', accent: 'slate' },
              { label: 'Pending', value: String(disbursement.pendingBatchCount), sub: 'awaiting action', accent: disbursement.pendingBatchCount > 0 ? 'amber' : 'slate' },
              { label: 'Service Fee Rate', value: '0.75%', sub: 'per batch', accent: 'slate' },
            ].map(card => (
              <div key={card.label} className="border border-gray-200 bg-white rounded-lg shadow-sm p-5">
                <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-3">{card.label}</p>
                <p className={`text-xl font-semibold ${card.accent === 'indigo' ? 'text-indigo-600' : card.accent === 'amber' ? 'text-amber-600' : 'text-gray-900'}`}>{card.value}</p>
                <p className="text-[10px] text-gray-400 mt-1">{card.sub}</p>
              </div>
            ))}
          </div>

          <div className="border border-gray-200 bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <p className="text-[10px] tracking-widest text-gray-400 uppercase">Recent Batches</p>
              <Link href="/enterprise/dashboard/disbursements/new" className="text-[10px] tracking-widest text-indigo-600 uppercase hover:text-indigo-700 transition-colors">+ New Batch</Link>
            </div>
            {disbursement.recentBatches.length === 0 ? (
              <p className="px-6 py-8 text-xs text-gray-400">No batches yet. <Link href="/enterprise/dashboard/disbursements/new" className="text-indigo-600 hover:underline">Upload your first CSV →</Link></p>
            ) : (
              <div className="divide-y divide-gray-100">
                {disbursement.recentBatches.map(b => (
                  <div key={b.id} className="px-6 py-4 flex items-center gap-6 hover:bg-gray-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800">{b.contractorCount} contractors</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{new Date(b.createdAt).toLocaleDateString()}</p>
                    </div>
                    <p className="text-sm font-semibold text-gray-900">TZS {fmt(b.totalAmountTzs)}</p>
                    <StatusBadge status={b.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending_review: { label: 'Pending Review', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
    awaiting_funds: { label: 'Awaiting Funds', cls: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
    approved:       { label: 'Approved',        cls: 'text-sky-700 bg-sky-50 border-sky-200' },
    processing:     { label: 'Processing',      cls: 'text-blue-700 bg-blue-50 border-blue-200' },
    completed:      { label: 'Completed',       cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    failed:         { label: 'Failed',          cls: 'text-red-700 bg-red-50 border-red-200' },
  }
  const s = map[status] ?? { label: status, cls: 'text-gray-500 bg-gray-100 border-gray-200' }
  return (
    <span className={`border px-2 py-0.5 text-[9px] font-semibold tracking-wider uppercase rounded ${s.cls}`}>
      {s.label}
    </span>
  )
}
