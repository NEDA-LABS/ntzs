'use client'

import { useEffect, useState } from 'react'

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

interface Merchant {
  id: string
  businessName: string | null
  handle: string
  lenderSplitPct: number
  loanId: string | null
  principalTzs: number | null
  repaidTzs: number | null
  loanStatus: string | null
}

export default function LoansPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/enterprise/api/lender/merchants')
      .then(r => r.json())
      .then(d => setMerchants((d.merchants ?? []).filter((m: Merchant) => m.loanId)))
      .finally(() => setLoading(false))
  }, [])

  const totalPrincipal = merchants.reduce((s, m) => s + (m.principalTzs ?? 0), 0)
  const totalRepaid = merchants.reduce((s, m) => s + (m.repaidTzs ?? 0), 0)
  const totalOutstanding = totalPrincipal - totalRepaid

  return (
    <div className="p-10 space-y-8">
      <div>
        <p className="text-[10px] tracking-widest text-slate-600 uppercase mb-1">Capital Lender</p>
        <h1 className="text-2xl font-light text-slate-100">Loan Agreements</h1>
      </div>

      {!loading && merchants.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Principal', value: `TZS ${fmt(totalPrincipal)}`, color: 'text-slate-100' },
            { label: 'Total Repaid', value: `TZS ${fmt(totalRepaid)}`, color: 'text-emerald-400' },
            { label: 'Outstanding', value: `TZS ${fmt(totalOutstanding)}`, color: 'text-indigo-400' },
          ].map(card => (
            <div key={card.label} className="border border-slate-800 bg-slate-900 p-5">
              <p className="text-[10px] tracking-widest text-slate-600 uppercase mb-2">{card.label}</p>
              <p className={`text-lg font-semibold ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-slate-800 rounded" />)}</div>
      ) : merchants.length === 0 ? (
        <div className="border border-slate-800 bg-slate-900 p-8 text-center">
          <p className="text-sm text-slate-600">No loan agreements yet. Contact NEDApay to set up loan terms with your merchants.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {merchants.map(m => {
            const pct = m.principalTzs && m.principalTzs > 0
              ? Math.round((m.repaidTzs ?? 0) / m.principalTzs * 100) : 0
            const outstanding = (m.principalTzs ?? 0) - (m.repaidTzs ?? 0)

            return (
              <div key={m.id} className="border border-slate-800 bg-slate-900 p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{m.businessName ?? m.handle}</p>
                    <p className="text-[10px] text-slate-600 mt-0.5">Split: <span className="text-indigo-400">{m.lenderSplitPct}%</span> per collection</p>
                  </div>
                  <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border ${
                    m.loanStatus === 'repaid' ? 'text-emerald-400 bg-emerald-950 border-emerald-900' :
                    m.loanStatus === 'active' ? 'text-indigo-400 bg-indigo-950 border-indigo-900' :
                    'text-slate-600 border-slate-800'
                  }`}>
                    {m.loanStatus ?? 'Unknown'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4 text-xs">
                  <div><p className="text-[10px] text-slate-600 mb-0.5">Principal</p><p className="text-slate-200">TZS {fmt(m.principalTzs ?? 0)}</p></div>
                  <div><p className="text-[10px] text-slate-600 mb-0.5">Repaid</p><p className="text-emerald-400">TZS {fmt(m.repaidTzs ?? 0)}</p></div>
                  <div><p className="text-[10px] text-slate-600 mb-0.5">Outstanding</p><p className="text-indigo-400">TZS {fmt(outstanding)}</p></div>
                </div>

                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[10px] text-slate-600 mt-1">{pct}% recovered</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
