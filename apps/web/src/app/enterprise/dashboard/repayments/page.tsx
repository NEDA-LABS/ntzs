'use client'

import { useEffect, useState } from 'react'

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

interface Repayment {
  id: string
  amountTzs: number
  status: string
  txHash: string | null
  metadata: Record<string, string> | null
  createdAt: string
}

export default function RepaymentsPage() {
  const [repayments, setRepayments] = useState<Repayment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/enterprise/api/lender/repayments')
      .then(r => r.json())
      .then(d => setRepayments(d.repayments ?? []))
      .finally(() => setLoading(false))
  }, [])

  function exportCsv() {
    const header = 'Date,Amount TZS,Status,Tx Hash,Merchant ID'
    const rows = repayments.map(r =>
      [new Date(r.createdAt).toISOString(), r.amountTzs, r.status, r.txHash ?? '', r.metadata?.merchantId ?? ''].join(',')
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'repayments.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-10 space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] tracking-widest text-slate-600 uppercase mb-1">Capital Lender</p>
          <h1 className="text-2xl font-light text-slate-100">Repayments</h1>
        </div>
        {repayments.length > 0 && (
          <button onClick={exportCsv} className="border border-slate-700 px-4 py-2 text-[10px] tracking-widest text-slate-500 uppercase hover:border-indigo-500 hover:text-indigo-400 transition-colors">
            Export CSV
          </button>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-800 rounded" />)}</div>
      ) : repayments.length === 0 ? (
        <div className="border border-slate-800 bg-slate-900 p-8 text-center">
          <p className="text-sm text-slate-600">No repayments yet. Repayments will appear here as merchants collect payments.</p>
        </div>
      ) : (
        <div className="border border-slate-800 bg-slate-900 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800">
                {['Date', 'Amount', 'Status', 'Tx Hash'].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-[10px] tracking-widest text-slate-600 uppercase font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {repayments.map(r => (
                <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-3 text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3 font-semibold text-indigo-400">TZS {fmt(r.amountTzs)}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border ${r.status === 'completed' ? 'text-emerald-400 bg-emerald-950 border-emerald-900' : r.status === 'failed' ? 'text-red-400 bg-red-950 border-red-900' : 'text-slate-400 bg-slate-900 border-slate-800'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {r.txHash ? (
                      <a
                        href={`https://basescan.org/tx/${r.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-indigo-500 hover:text-indigo-400 font-mono"
                      >
                        {r.txHash.slice(0, 10)}…{r.txHash.slice(-6)}
                      </a>
                    ) : (
                      <span className="text-slate-700">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
