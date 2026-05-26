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
  pending_review: 'text-amber-700 bg-amber-50 border-amber-200',
  awaiting_funds: 'text-sky-700 bg-sky-50 border-sky-200',
  approved:       'text-indigo-700 bg-indigo-50 border-indigo-200',
  processing:     'text-violet-700 bg-violet-50 border-violet-200',
  completed:      'text-emerald-700 bg-emerald-50 border-emerald-200',
  failed:         'text-red-700 bg-red-50 border-red-200',
}

const STATUS_LABELS: Record<BatchStatus, string> = {
  pending_review: 'Pending Review',
  awaiting_funds: 'Awaiting Funds',
  approved:       'Approved',
  processing:     'Processing',
  completed:      'Completed',
  failed:         'Failed',
}

function StatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border rounded-sm font-medium ${STATUS_STYLES[status]}`}>
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
    <div className="min-h-full">
      {/* Page header */}
      <div className="bg-white border-b border-slate-200 px-10 py-6">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1.5">Disbursement Client</p>
            <h1 className="text-2xl font-light text-slate-900 tracking-tight">Disbursements</h1>
          </div>
          <Link
            href="/enterprise/dashboard/disbursements/new"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs tracking-wide transition-colors rounded-sm"
          >
            + New Batch
          </Link>
        </div>
      </div>

      <div className="p-10 space-y-6">
        {/* Stats strip */}
        {!loading && batches.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Disbursed', value: `TZS ${fmt(totalDisbursed)}`, accent: 'border-l-indigo-500' },
              { label: 'Total Batches', value: batches.length.toString(), accent: 'border-l-slate-400' },
              { label: 'Active / Pending', value: pendingCount.toString(), accent: 'border-l-amber-400' },
            ].map(card => (
              <div key={card.label} className={`bg-white border border-slate-200 border-l-4 ${card.accent} px-5 py-4 shadow-sm`}>
                <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-2">{card.label}</p>
                <p className="text-lg font-semibold text-slate-900 tabular-nums">{card.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Table / empty state */}
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 bg-slate-200 rounded animate-pulse" />
            ))}
          </div>
        ) : batches.length === 0 ? (
          <div className="bg-white border border-slate-200 shadow-sm rounded-sm p-16 text-center space-y-4">
            <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm text-slate-500">No disbursement batches yet.</p>
            <Link
              href="/enterprise/dashboard/disbursements/new"
              className="inline-block px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs tracking-wide transition-colors rounded-sm"
            >
              Upload your first CSV
            </Link>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 shadow-sm rounded-sm overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-5 py-3 text-left text-[10px] tracking-widest text-slate-400 uppercase font-medium">Batch</th>
                  <th className="px-5 py-3 text-left text-[10px] tracking-widest text-slate-400 uppercase font-medium">Date</th>
                  <th className="px-5 py-3 text-right text-[10px] tracking-widest text-slate-400 uppercase font-medium">Contractors</th>
                  <th className="px-5 py-3 text-right text-[10px] tracking-widest text-slate-400 uppercase font-medium">Total (TZS)</th>
                  <th className="px-5 py-3 text-right text-[10px] tracking-widest text-slate-400 uppercase font-medium">Fee (TZS)</th>
                  <th className="px-5 py-3 text-left text-[10px] tracking-widest text-slate-400 uppercase font-medium">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 text-slate-700 font-mono text-[11px]">
                      {b.filename ?? b.id.slice(0, 8)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">{fmtDate(b.createdAt)}</td>
                    <td className="px-5 py-3.5 text-right text-slate-700">{b.contractorCount}</td>
                    <td className="px-5 py-3.5 text-right text-slate-900 font-medium tabular-nums">{fmt(b.totalAmountTzs)}</td>
                    <td className="px-5 py-3.5 text-right text-slate-400 tabular-nums">{fmt(b.serviceFeeTzs)}</td>
                    <td className="px-5 py-3.5"><StatusBadge status={b.status} /></td>
                    <td className="px-5 py-3.5 text-right">
                      <Link href={`/enterprise/dashboard/disbursements/${b.id}`} className="text-indigo-600 hover:text-indigo-800 font-medium">
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
    </div>
  )
}
