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
        <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-1">Capital Lender</p>
        <h1 className="text-2xl font-light text-gray-900">Merchant Portfolio</h1>
        <p className="text-sm text-gray-400 mt-1">Configure repayment splits and monitor loan progress per merchant.</p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-200 rounded" />)}
        </div>
      ) : merchants.length === 0 ? (
        <div className="border border-gray-200 bg-white rounded-lg p-8 text-center shadow-sm">
          <p className="text-sm text-gray-500">No merchants linked yet.</p>
          <p className="text-xs text-gray-400 mt-2">Contact NEDApay to link merchants to your account.</p>
        </div>
      ) : (
        <div className="border border-gray-200 bg-white rounded-lg shadow-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {['Merchant', 'Your Split', 'Merchant Gets', 'Principal', 'Repaid', 'Progress', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-[10px] tracking-widest text-gray-400 uppercase font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {merchants.map(m => {
                const pct = m.principalTzs && m.principalTzs > 0
                  ? Math.round((m.repaidTzs ?? 0) / m.principalTzs * 100) : 0
                return (
                  <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-800">{m.businessName ?? m.handle}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">@{m.handle}</p>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-indigo-600 font-semibold">{m.lenderSplitPct}%</span>
                    </td>
                    <td className="px-5 py-4 text-gray-500">{m.settlePct}%</td>
                    <td className="px-5 py-4 text-gray-700">{m.principalTzs ? `TZS ${fmt(m.principalTzs)}` : '—'}</td>
                    <td className="px-5 py-4 text-emerald-600">{m.repaidTzs ? `TZS ${fmt(m.repaidTzs)}` : '—'}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-gray-400">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {m.loanStatus === 'repaid' ? (
                        <span className="text-[9px] tracking-wider uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">Repaid</span>
                      ) : m.loanStatus === 'active' ? (
                        <span className="text-[9px] tracking-wider uppercase text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">Active</span>
                      ) : (
                        <span className="text-[9px] tracking-wider uppercase text-gray-500 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded">No Loan</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/enterprise/dashboard/merchants/${m.id}/split`}
                        className="text-[10px] tracking-widest text-indigo-600 uppercase hover:text-indigo-700 transition-colors"
                      >
                        Edit →
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
