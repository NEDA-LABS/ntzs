'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Recipient {
  phone: string
  name: string
  totalTzs: number
  completedTzs: number
  payoutCount: number
  successCount: number
  failedCount: number
  lastPaidAt: string
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}
function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function RecipientsPage() {
  const router = useRouter()
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    fetch('/enterprise/api/disbursements/recipients')
      .then(r => {
        if (r.status === 401) { router.push('/enterprise/login'); return null }
        return r.json()
      })
      .then(d => { if (d?.recipients) setRecipients(d.recipients) })
      .finally(() => setLoading(false))
  }, [router])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return recipients
    return recipients.filter(r => r.name?.toLowerCase().includes(term) || r.phone.includes(term))
  }, [recipients, q])

  const totalPaid = recipients.reduce((s, r) => s + r.completedTzs, 0)

  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-slate-200 px-10 py-6">
        <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1.5">Disbursement Client</p>
        <h1 className="text-2xl font-light text-slate-900 tracking-tight">Recipients</h1>
        <p className="text-xs text-slate-400 mt-1">Everyone you&apos;ve paid, aggregated across all batches.</p>
      </div>

      <div className="p-10 space-y-5 max-w-5xl">
        {/* Summary */}
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          {[
            { label: 'Unique Recipients', value: String(recipients.length) },
            { label: 'Total Paid (completed)', value: `TZS ${fmt(totalPaid)}` },
            { label: 'Total Payouts', value: String(recipients.reduce((s, r) => s + r.payoutCount, 0)) },
          ].map(c => (
            <div key={c.label} className="bg-white border border-slate-200 p-4 shadow-sm rounded-sm">
              <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1">{c.label}</p>
              <p className="text-sm font-semibold text-slate-900 tabular-nums">{c.value}</p>
            </div>
          ))}
        </div>

        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by name or phone…"
          className="w-full max-w-sm border border-slate-200 rounded-sm px-3 py-2 text-xs text-slate-800 focus:border-indigo-400 focus:outline-none"
        />

        <div className="bg-white border border-slate-200 shadow-sm rounded-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['Recipient', 'Phone', 'Payouts', 'Success rate', 'Total Paid (TZS)', 'Last paid'].map((h, i) => (
                  <th key={h} className={`px-4 py-3 text-[10px] tracking-widest text-slate-400 uppercase font-medium ${i >= 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                [...Array(4)].map((_, i) => (
                  <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td></tr>
                ))
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-xs">No recipients yet — create a batch to get started.</td></tr>
              )}
              {!loading && filtered.map(r => {
                const rate = r.payoutCount > 0 ? Math.round((r.successCount / r.payoutCount) * 100) : 0
                return (
                  <tr
                    key={r.phone}
                    onClick={() => router.push(`/enterprise/dashboard/disbursements/recipients/${encodeURIComponent(r.phone)}`)}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 text-slate-800 font-medium">{r.name || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono">{r.phone}</td>
                    <td className="px-4 py-3 text-left text-slate-600">
                      {r.payoutCount}
                      {r.failedCount > 0 && <span className="text-red-500 ml-1">({r.failedCount} failed)</span>}
                    </td>
                    <td className="px-4 py-3 text-left">
                      <span className={rate >= 90 ? 'text-emerald-600' : rate >= 50 ? 'text-amber-600' : 'text-red-600'}>{rate}%</span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 font-medium tabular-nums">{fmt(r.completedTzs)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{fmtDate(r.lastPaidAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <Link href="/enterprise/dashboard/disbursements" className="inline-block text-xs text-indigo-600 hover:text-indigo-800">
          ← Back to batches
        </Link>
      </div>
    </div>
  )
}
