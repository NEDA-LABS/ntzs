'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type RowStatus = 'pending' | 'processing' | 'completed' | 'failed'

interface Payout {
  id: string
  contractorName: string
  amountTzs: number
  payoutMethod: 'mobile' | 'eft'
  status: RowStatus
  payoutReference: string | null
  payoutError: string | null
  createdAt: string
  batchId: string
  batchFilename: string | null
  batchStatus: string
}

interface RecipientSummary {
  phone: string
  name: string
  payoutCount: number
  successCount: number
  failedCount: number
  totalTzs: number
  completedTzs: number
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}
function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const ROW_STATUS_STYLES: Record<RowStatus, string> = {
  pending: 'text-slate-500 bg-slate-50 border-slate-200',
  processing: 'text-violet-700 bg-violet-50 border-violet-200',
  completed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  failed: 'text-red-700 bg-red-50 border-red-200',
}

export default function RecipientDetailPage() {
  const { phone } = useParams<{ phone: string }>()
  const router = useRouter()
  const [summary, setSummary] = useState<RecipientSummary | null>(null)
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const decoded = decodeURIComponent(phone)
    fetch(`/enterprise/api/disbursements/recipients?phone=${encodeURIComponent(decoded)}`)
      .then(r => {
        if (r.status === 401) { router.push('/enterprise/login'); return null }
        if (r.status === 404) { setNotFound(true); return null }
        return r.json()
      })
      .then(d => { if (d?.recipient) { setSummary(d.recipient); setPayouts(d.payouts ?? []) } })
      .finally(() => setLoading(false))
  }, [phone, router])

  if (loading) {
    return (
      <div className="min-h-full">
        <div className="bg-white border-b border-slate-200 px-10 py-6">
          <div className="h-4 w-32 bg-slate-200 rounded animate-pulse mb-2" />
          <div className="h-7 w-64 bg-slate-200 rounded animate-pulse" />
        </div>
        <div className="p-10 space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-slate-200 rounded animate-pulse" />)}</div>
      </div>
    )
  }

  if (notFound || !summary) {
    return (
      <div className="min-h-full">
        <div className="bg-white border-b border-slate-200 px-10 py-6"><p className="text-sm text-slate-500">Recipient not found.</p></div>
        <div className="p-10"><Link href="/enterprise/dashboard/disbursements/recipients" className="text-xs text-indigo-600 hover:text-indigo-800">← Back to recipients</Link></div>
      </div>
    )
  }

  const rate = summary.payoutCount > 0 ? Math.round((summary.successCount / summary.payoutCount) * 100) : 0

  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-slate-200 px-10 py-6">
        <Link href="/enterprise/dashboard/disbursements/recipients" className="text-[10px] tracking-widest text-slate-400 uppercase hover:text-slate-600 transition-colors">
          ← Recipients
        </Link>
        <h1 className="text-2xl font-light text-slate-900 tracking-tight mt-1.5">{summary.name || 'Recipient'}</h1>
        <p className="text-xs text-slate-400 mt-0.5 font-mono">{summary.phone}</p>
      </div>

      <div className="p-10 space-y-6 max-w-4xl">
        {/* Summary cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: 'Total Paid (completed)', value: `TZS ${fmt(summary.completedTzs)}`, accent: 'border-l-indigo-500', color: 'text-indigo-700' },
            { label: 'Lifetime Volume', value: `TZS ${fmt(summary.totalTzs)}`, accent: 'border-l-slate-400', color: 'text-slate-900' },
            { label: 'Payouts', value: String(summary.payoutCount), accent: 'border-l-slate-300', color: 'text-slate-900' },
            { label: 'Success Rate', value: `${rate}%`, accent: rate >= 90 ? 'border-l-emerald-500' : 'border-l-amber-400', color: rate >= 90 ? 'text-emerald-700' : 'text-amber-700' },
          ].map(c => (
            <div key={c.label} className={`bg-white border border-slate-200 border-l-4 ${c.accent} px-5 py-4 shadow-sm rounded-sm`}>
              <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1">{c.label}</p>
              <p className={`text-sm font-semibold tabular-nums ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Payout history */}
        <div className="bg-white border border-slate-200 shadow-sm rounded-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
            <p className="text-[10px] tracking-widest text-slate-400 uppercase font-medium">Payout History ({payouts.length})</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                {['Date', 'Amount (TZS)', 'Method', 'Status', 'Batch', 'Reference'].map((h, i) => (
                  <th key={h} className={`px-4 py-3 text-[10px] tracking-widest text-slate-400 uppercase font-medium ${i === 1 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payouts.map(p => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-slate-500">{fmtDate(p.createdAt)}</td>
                  <td className="px-4 py-3 text-right text-slate-900 font-medium tabular-nums">{fmt(p.amountTzs)}</td>
                  <td className="px-4 py-3 text-slate-500 uppercase text-[10px]">{p.payoutMethod}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border rounded-sm font-medium ${ROW_STATUS_STYLES[p.status]}`}>{p.status}</span>
                    {p.payoutError && <p className="text-[10px] text-red-600 mt-0.5">{p.payoutError}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/enterprise/dashboard/disbursements/${p.batchId}`} className="text-indigo-600 hover:text-indigo-800 font-mono text-[11px]">
                      {p.batchFilename ?? p.batchId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-[10px]">{p.payoutReference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
