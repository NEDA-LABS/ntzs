'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

interface Merchant {
  id: string
  businessName: string | null
  handle: string
  lenderSplitPct: number
  settlePct: number
  lenderPendingTzs: number
  isActive: boolean
  loanId: string | null
  principalTzs: number | null
  repaidTzs: number | null
  loanStatus: string | null
}

export default function MerchantsPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/enterprise/api/lender/merchants')
      .then(r => r.json())
      .then(d => setMerchants(d.merchants ?? []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-10 space-y-8">
      <div>
        <p className="text-[10px] tracking-widest text-slate-600 uppercase mb-1">Capital Lender</p>
        <h1 className="text-2xl font-light text-slate-100">Merchant Portfolio</h1>
        <p className="text-sm text-slate-600 mt-1">Configure repayment splits and monitor loan progress per merchant.</p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-slate-800 rounded" />)}
        </div>
      ) : merchants.length === 0 ? (
        <div className="border border-slate-800 bg-slate-900 p-8 text-center">
          <p className="text-sm text-slate-600">No merchants linked yet.</p>
          <p className="text-xs text-slate-700 mt-2">Contact NEDApay to link merchants to your account.</p>
        </div>
      ) : (
        <div className="border border-slate-800 bg-slate-900 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800">
                {['Merchant', 'Your Split', 'Merchant Gets', 'Principal', 'Repaid', 'Progress', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-[10px] tracking-widest text-slate-600 uppercase font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {merchants.map(m => {
                const pct = m.principalTzs && m.principalTzs > 0
                  ? Math.round((m.repaidTzs ?? 0) / m.principalTzs * 100) : 0
                return (
                  <tr key={m.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-200">{m.businessName ?? m.handle}</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">@{m.handle}</p>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-indigo-400 font-semibold">{m.lenderSplitPct}%</span>
                    </td>
                    <td className="px-5 py-4 text-slate-400">{m.settlePct}%</td>
                    <td className="px-5 py-4 text-slate-300">{m.principalTzs ? `TZS ${fmt(m.principalTzs)}` : '—'}</td>
                    <td className="px-5 py-4 text-emerald-400">{m.repaidTzs ? `TZS ${fmt(m.repaidTzs)}` : '—'}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-slate-600">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {m.loanStatus === 'repaid' ? (
                        <span className="text-[9px] tracking-wider uppercase text-emerald-500 bg-emerald-950 border border-emerald-900 px-2 py-0.5">Repaid</span>
                      ) : m.loanStatus === 'active' ? (
                        <span className="text-[9px] tracking-wider uppercase text-indigo-400 bg-indigo-950 border border-indigo-900 px-2 py-0.5">Active</span>
                      ) : (
                        <span className="text-[9px] tracking-wider uppercase text-slate-600 bg-slate-900 border border-slate-800 px-2 py-0.5">No Loan</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/enterprise/dashboard/merchants/${m.id}/split`}
                        className="text-[10px] tracking-widest text-indigo-500 uppercase hover:text-indigo-400 transition-colors"
                      >
                        Edit Split →
                      </Link>
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
