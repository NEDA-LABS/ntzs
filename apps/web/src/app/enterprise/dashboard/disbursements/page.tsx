'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type BatchStatus =
  | 'pending_review'
  | 'awaiting_funds'
  | 'approved'
  | 'processing'
  | 'completed'
  | 'failed'

interface Batch {
  id: string
  filename: string | null
  totalAmountTzs: number
  serviceFeeTzs: number
  contractorCount: number
  status: BatchStatus
  createdAt: string
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS_STYLES: Record<BatchStatus, string> = {
  pending_review: 'text-amber-400 bg-amber-950 border-amber-900',
  awaiting_funds:  'text-sky-400 bg-sky-950 border-sky-900',
  approved:        'text-indigo-400 bg-indigo-950 border-indigo-900',
  processing:      'text-violet-400 bg-violet-950 border-violet-900',
  completed:       'text-emerald-400 bg-emerald-950 border-emerald-900',
  failed:          'text-red-400 bg-red-950 border-red-900',
}

const STATUS_LABELS: Record<BatchStatus, string> = {
  pending_review:  'Pending Review',
  awaiting_funds:  'Awaiting Funds',
  approved:        'Approved',
  processing:      'Processing',
  completed:       'Completed',
  failed:          'Failed',
}

function StatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export default function DisbursementsPage() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/enterprise/api/disbursements')
      .then(r => r.json())
      .then(d => setBatches(d.batches ?? []))
      .finally(() => setLoading(false))
  }, [])

  const totalDisbursed = batches.filter(b => b.status === 'completed').reduce((s, b) => s + b.totalAmountTzs, 0)
  const pendingCount = batches.filter(b => ['pending_review', 'awaiting_funds', 'approved', 'processing'].includes(b.status)).length

  return (
    <div className="p-10 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] tracking-widest text-slate-600 uppercase mb-1">Disbursement Client</p>
          <h1 className="text-2xl font-light text-slate-100">Disbursements</h1>
        </div>
        <Link
          href="/enterprise/dashboard/disbursements/new"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs tracking-wide transition-colors"
        >
          + New Batch
        </Link>
      </div>

      {!loading && batches.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Disbursed', value: `TZS ${fmt(totalDisbursed)}`, color: 'text-slate-100' },
            { label: 'Total Batches', value: batches.length.toString(), color: 'text-indigo-400' },
            { label: 'Pending', value: pendingCount.toString(), color: 'text-amber-400' },
          ].map(card => (
            <div key={card.label} className="border border-slate-800 bg-slate-900 p-5">
              <p className="text-[10px] tracking-widest text-slate-600 uppercase mb-2">{card.label}</p>
              <p className={`text-lg font-semibold ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-slate-800 rounded" />)}
        </div>
      ) : batches.length === 0 ? (
        <div className="border border-slate-800 bg-slate-900 p-12 text-center space-y-4">
          <p className="text-sm text-slate-400">No disbursement batches yet.</p>
          <Link
            href="/enterprise/dashboard/disbursements/new"
            className="inline-block px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs tracking-wide transition-colors"
          >
            Upload your first CSV
          </Link>
        </div>
      ) : (
        <div className="border border-slate-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] tracking-widest text-slate-600 uppercase">
                <th className="px-4 py-3 text-left">Batch</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-right">Contractors</th>
                <th className="px-4 py-3 text-right">Total (TZS)</th>
                <th className="px-4 py-3 text-right">Fee (TZS)</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => (
                <tr
                  key={b.id}
                  className={`border-b border-slate-800 last:border-0 ${i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-950'}`}
                >
                  <td className="px-4 py-3 text-slate-300 font-mono">
                    {b.filename ?? b.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(b.createdAt)}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{b.contractorCount}</td>
                  <td className="px-4 py-3 text-right text-slate-100 tabular-nums">{fmt(b.totalAmountTzs)}</td>
                  <td className="px-4 py-3 text-right text-slate-500 tabular-nums">{fmt(b.serviceFeeTzs)}</td>
                  <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/enterprise/dashboard/disbursements/${b.id}`} className="text-indigo-400 hover:text-indigo-300">
                      View →
                    </Link>
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
