'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type BatchStatus = 'pending_review' | 'awaiting_funds' | 'approved' | 'processing' | 'completed' | 'failed'
type RowStatus = 'pending' | 'processing' | 'completed' | 'failed'

interface Batch {
  id: string
  filename: string | null
  totalAmountTzs: number
  serviceFeeTzs: number
  contractorCount: number
  status: BatchStatus
  bankReference: string | null
  processedAt: string | null
  createdAt: string
}

interface DisbursementRow {
  id: string
  contractorName: string
  phone: string
  amountTzs: number
  payoutMethod: 'mobile' | 'eft'
  bankAccount: string | null
  status: RowStatus
  payoutReference: string | null
  payoutError: string | null
  createdAt: string
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const BATCH_STATUS_STYLES: Record<BatchStatus, string> = {
  pending_review: 'text-amber-400 bg-amber-950 border-amber-900',
  awaiting_funds: 'text-sky-400 bg-sky-950 border-sky-900',
  approved:       'text-indigo-400 bg-indigo-950 border-indigo-900',
  processing:     'text-violet-400 bg-violet-950 border-violet-900',
  completed:      'text-emerald-400 bg-emerald-950 border-emerald-900',
  failed:         'text-red-400 bg-red-950 border-red-900',
}

const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  pending_review: 'Pending Review',
  awaiting_funds: 'Awaiting Funds',
  approved:       'Approved',
  processing:     'Processing',
  completed:      'Completed',
  failed:         'Failed',
}

const ROW_STATUS_STYLES: Record<RowStatus, string> = {
  pending:    'text-slate-500 border-slate-700',
  processing: 'text-violet-400 bg-violet-950 border-violet-900',
  completed:  'text-emerald-400 bg-emerald-950 border-emerald-900',
  failed:     'text-red-400 bg-red-950 border-red-900',
}

function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border ${BATCH_STATUS_STYLES[status]}`}>
      {BATCH_STATUS_LABELS[status]}
    </span>
  )
}

function RowStatusBadge({ status }: { status: RowStatus }) {
  return (
    <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border ${ROW_STATUS_STYLES[status]}`}>
      {status}
    </span>
  )
}

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [batch, setBatch] = useState<Batch | null>(null)
  const [rows, setRows] = useState<DisbursementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/enterprise/api/disbursements/${id}`)
      .then(r => {
        if (r.status === 401) { router.push('/enterprise/login'); return null }
        return r.json()
      })
      .then(d => {
        if (!d) return
        setBatch(d.batch)
        setRows(d.rows ?? [])
      })
      .finally(() => setLoading(false))
  }, [id, router])

  async function confirmTransfer() {
    setConfirming(true)
    setConfirmError(null)
    try {
      const res = await fetch(`/enterprise/api/disbursements/${id}/confirm`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setConfirmError(data.error ?? 'Failed'); return }
      setBatch(prev => prev ? { ...prev, status: 'awaiting_funds' } : prev)
    } catch {
      setConfirmError('Network error — please try again.')
    } finally {
      setConfirming(false)
    }
  }

  function downloadReport() {
    window.open(`/enterprise/api/disbursements/${id}/report`, '_blank')
  }

  const completedCount = rows.filter(r => r.status === 'completed').length
  const failedCount = rows.filter(r => r.status === 'failed').length

  if (loading) {
    return (
      <div className="p-10">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-slate-800 rounded" />
          <div className="h-32 bg-slate-800 rounded" />
          <div className="h-64 bg-slate-800 rounded" />
        </div>
      </div>
    )
  }

  if (!batch) {
    return (
      <div className="p-10">
        <p className="text-sm text-slate-500">Batch not found.</p>
        <Link href="/enterprise/dashboard/disbursements" className="text-xs text-indigo-400 hover:text-indigo-300 mt-2 inline-block">
          ← Back to disbursements
        </Link>
      </div>
    )
  }

  return (
    <div className="p-10 space-y-8 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/enterprise/dashboard/disbursements" className="text-[10px] tracking-widest text-slate-600 uppercase hover:text-slate-400 transition-colors">
              ← Disbursements
            </Link>
          </div>
          <h1 className="text-2xl font-light text-slate-100">
            {batch.filename ?? `Batch ${batch.id.slice(0, 8)}`}
          </h1>
          <p className="text-xs text-slate-600 mt-1">{fmtDate(batch.createdAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          {batch.status === 'completed' && (
            <button
              onClick={downloadReport}
              className="px-4 py-2 border border-slate-700 text-slate-400 hover:text-slate-200 text-xs tracking-wide transition-colors"
            >
              Download Report
            </button>
          )}
          <BatchStatusBadge status={batch.status} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Contractors', value: batch.contractorCount.toString(), color: 'text-slate-100' },
          { label: 'Disbursement Total', value: `TZS ${fmt(batch.totalAmountTzs)}`, color: 'text-slate-100' },
          { label: 'Service Fee', value: `TZS ${fmt(batch.serviceFeeTzs)}`, color: 'text-slate-400' },
          { label: 'Total Due', value: `TZS ${fmt(batch.totalAmountTzs + batch.serviceFeeTzs)}`, color: 'text-indigo-400' },
        ].map(c => (
          <div key={c.label} className="border border-slate-800 bg-slate-900 p-4">
            <p className="text-[10px] tracking-widest text-slate-600 uppercase mb-1">{c.label}</p>
            <p className={`text-sm font-semibold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {rows.length > 0 && batch.status !== 'pending_review' && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Completed', value: completedCount, color: 'text-emerald-400' },
            { label: 'Failed', value: failedCount, color: failedCount > 0 ? 'text-red-400' : 'text-slate-600' },
            { label: 'Pending / Processing', value: rows.length - completedCount - failedCount, color: 'text-slate-400' },
          ].map(c => (
            <div key={c.label} className="border border-slate-800 bg-slate-900 p-4">
              <p className="text-[10px] tracking-widest text-slate-600 uppercase mb-1">{c.label}</p>
              <p className={`text-lg font-semibold ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {batch.status === 'pending_review' && (
        <div className="border border-amber-900 bg-amber-950/20 p-5 space-y-3">
          <p className="text-xs text-amber-400 font-medium">Action required: Confirm bank transfer</p>
          <p className="text-xs text-slate-400">
            Transfer <span className="text-indigo-400 font-semibold">TZS {fmt(batch.totalAmountTzs + batch.serviceFeeTzs)}</span> to
            the NEDApay collection account, using batch ID <span className="font-mono text-slate-300">{batch.id.slice(0, 8)}</span> as reference.
            Then click below to notify NEDApay.
          </p>
          {confirmError && <p className="text-xs text-red-400">{confirmError}</p>}
          <button
            onClick={confirmTransfer}
            disabled={confirming}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs tracking-wide transition-colors"
          >
            {confirming ? 'Confirming…' : 'Confirm transfer initiated'}
          </button>
        </div>
      )}

      {batch.status === 'awaiting_funds' && (
        <div className="border border-sky-900 bg-sky-950/20 p-4">
          <p className="text-xs text-sky-400">Awaiting bank transfer confirmation from NEDApay ops. Disbursements will begin once funds are verified.</p>
        </div>
      )}

      <div className="border border-slate-800">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
          <p className="text-[10px] tracking-widest text-slate-600 uppercase">Contractors ({rows.length})</p>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] tracking-widest text-slate-600 uppercase bg-slate-950">
              <th className="px-4 py-3 text-left">#</th>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Phone</th>
              <th className="px-4 py-3 text-right">Amount (TZS)</th>
              <th className="px-4 py-3 text-left">Method</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-b border-slate-800 last:border-0 ${i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-950'}`}>
                <td className="px-4 py-3 text-slate-600">{i + 1}</td>
                <td className="px-4 py-3 text-slate-300">{r.contractorName}</td>
                <td className="px-4 py-3 text-slate-500 font-mono">{r.phone}</td>
                <td className="px-4 py-3 text-right text-slate-200 tabular-nums">{fmt(r.amountTzs)}</td>
                <td className="px-4 py-3 text-slate-600 uppercase text-[10px]">{r.payoutMethod}</td>
                <td className="px-4 py-3">
                  <RowStatusBadge status={r.status} />
                  {r.payoutError && (
                    <p className="text-[10px] text-red-400 mt-0.5">{r.payoutError}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600 font-mono text-[10px]">
                  {r.payoutReference ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
