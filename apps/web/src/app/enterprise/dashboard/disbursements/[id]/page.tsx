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

// NEDApay collection account — keep in sync with the new-batch page.
const COLLECTION_ACCOUNT = {
  bank: 'Selcom Microfinance Bank',
  accountName: 'Neda Labs Limited',
  accountNumber: '55271 07446 681',
  swift: 'ACTZTZTZ',
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const BATCH_STATUS_STYLES: Record<BatchStatus, string> = {
  pending_review: 'text-amber-700 bg-amber-50 border-amber-200',
  awaiting_funds: 'text-sky-700 bg-sky-50 border-sky-200',
  approved:       'text-indigo-700 bg-indigo-50 border-indigo-200',
  processing:     'text-violet-700 bg-violet-50 border-violet-200',
  completed:      'text-emerald-700 bg-emerald-50 border-emerald-200',
  failed:         'text-red-700 bg-red-50 border-red-200',
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
  pending:    'text-slate-500 bg-slate-50 border-slate-200',
  processing: 'text-violet-700 bg-violet-50 border-violet-200',
  completed:  'text-emerald-700 bg-emerald-50 border-emerald-200',
  failed:     'text-red-700 bg-red-50 border-red-200',
}

function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border rounded-sm font-medium ${BATCH_STATUS_STYLES[status]}`}>
      {BATCH_STATUS_LABELS[status]}
    </span>
  )
}

function RowStatusBadge({ status }: { status: RowStatus }) {
  return (
    <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border rounded-sm font-medium ${ROW_STATUS_STYLES[status]}`}>
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
      <div className="min-h-full">
        <div className="bg-white border-b border-slate-200 px-10 py-6">
          <div className="h-4 w-32 bg-slate-200 rounded animate-pulse mb-2" />
          <div className="h-7 w-64 bg-slate-200 rounded animate-pulse" />
        </div>
        <div className="p-10 space-y-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-slate-200 rounded animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (!batch) {
    return (
      <div className="min-h-full">
        <div className="bg-white border-b border-slate-200 px-10 py-6">
          <p className="text-sm text-slate-500">Batch not found.</p>
        </div>
        <div className="p-10">
          <Link href="/enterprise/dashboard/disbursements" className="text-xs text-indigo-600 hover:text-indigo-800">
            ← Back to disbursements
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full">
      {/* Page header */}
      <div className="bg-white border-b border-slate-200 px-10 py-6">
        <div className="flex items-end justify-between">
          <div>
            <Link
              href="/enterprise/dashboard/disbursements"
              className="text-[10px] tracking-widest text-slate-400 uppercase hover:text-slate-600 transition-colors"
            >
              ← Disbursements
            </Link>
            <h1 className="text-2xl font-light text-slate-900 tracking-tight mt-1.5">
              {batch.filename ?? `Batch ${batch.id.slice(0, 8)}`}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">{fmtDate(batch.createdAt)}</p>
          </div>
          <div className="flex items-center gap-3">
            {batch.status === 'completed' && (
              <button
                onClick={downloadReport}
                className="px-4 py-2 border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 text-xs tracking-wide transition-colors rounded-sm"
              >
                Download Report
              </button>
            )}
            <BatchStatusBadge status={batch.status} />
          </div>
        </div>
      </div>

      <div className="p-10 space-y-6 max-w-5xl">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Contractors', value: batch.contractorCount.toString(), accent: 'border-l-slate-400' },
            { label: 'Disbursement Total', value: `TZS ${fmt(batch.totalAmountTzs)}`, accent: 'border-l-slate-400' },
            { label: 'Service Fee', value: `TZS ${fmt(batch.serviceFeeTzs)}`, accent: 'border-l-slate-300', muted: true },
            { label: 'Total Due', value: `TZS ${fmt(batch.totalAmountTzs + batch.serviceFeeTzs)}`, accent: 'border-l-indigo-500' },
          ].map(c => (
            <div key={c.label} className={`bg-white border border-slate-200 border-l-4 ${c.accent} px-5 py-4 shadow-sm rounded-sm`}>
              <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1">{c.label}</p>
              <p className={`text-sm font-semibold tabular-nums ${c.muted ? 'text-slate-400' : 'text-slate-900'}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Row-level stats */}
        {rows.length > 0 && batch.status !== 'pending_review' && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Completed', value: completedCount, accent: 'border-l-emerald-500', color: 'text-emerald-700' },
              { label: 'Failed', value: failedCount, accent: failedCount > 0 ? 'border-l-red-500' : 'border-l-slate-200', color: failedCount > 0 ? 'text-red-700' : 'text-slate-400' },
              { label: 'Pending / Processing', value: rows.length - completedCount - failedCount, accent: 'border-l-slate-300', color: 'text-slate-500' },
            ].map(c => (
              <div key={c.label} className={`bg-white border border-slate-200 border-l-4 ${c.accent} px-5 py-4 shadow-sm rounded-sm`}>
                <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1">{c.label}</p>
                <p className={`text-lg font-semibold ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Pending review action */}
        {batch.status === 'pending_review' && (
          <div className="bg-white border border-amber-200 border-l-4 border-l-amber-400 p-5 space-y-4 shadow-sm rounded-sm">
            <p className="text-sm text-amber-800 font-medium">Action required: fund this batch</p>
            <p className="text-xs text-slate-600">
              Transfer <span className="text-indigo-700 font-semibold">TZS {fmt(batch.totalAmountTzs + batch.serviceFeeTzs)}</span> to the NEDApay collection account below, then click to notify NEDApay.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs border-t border-slate-100 pt-4">
              {[
                { label: 'Bank', value: COLLECTION_ACCOUNT.bank },
                { label: 'Account Name', value: COLLECTION_ACCOUNT.accountName },
                { label: 'Account Number', value: COLLECTION_ACCOUNT.accountNumber, mono: true },
                { label: 'SWIFT', value: COLLECTION_ACCOUNT.swift, mono: true },
                { label: 'Amount', value: `TZS ${fmt(batch.totalAmountTzs + batch.serviceFeeTzs)}`, accent: true },
                { label: 'Reference (required)', value: batch.id.slice(0, 8).toUpperCase(), mono: true, accent: true },
              ].map(f => (
                <div key={f.label}>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">{f.label}</p>
                  <p className={`${f.mono ? 'font-mono' : ''} ${f.accent ? 'text-indigo-700 font-semibold' : 'text-slate-900'}`}>{f.value}</p>
                </div>
              ))}
            </div>
            {confirmError && <p className="text-xs text-red-600">{confirmError}</p>}
            <button
              onClick={confirmTransfer}
              disabled={confirming}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs tracking-wide transition-colors rounded-sm"
            >
              {confirming ? 'Confirming…' : 'Confirm transfer initiated'}
            </button>
          </div>
        )}

        {batch.status === 'awaiting_funds' && (
          <div className="bg-sky-50 border border-sky-200 border-l-4 border-l-sky-400 px-5 py-4 rounded-sm">
            <p className="text-xs text-sky-700">Awaiting bank transfer confirmation from NEDApay ops. Disbursements will begin once funds are verified.</p>
          </div>
        )}

        {/* Contractors table */}
        <div className="bg-white border border-slate-200 shadow-sm rounded-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <p className="text-[10px] tracking-widest text-slate-400 uppercase font-medium">Contractors ({rows.length})</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                {['#', 'Name', 'Phone', 'Amount (TZS)', 'Method', 'Status', 'Reference'].map(h => (
                  <th key={h} className={`px-4 py-3 text-[10px] tracking-widest text-slate-400 uppercase font-medium ${h === 'Amount (TZS)' ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-3 text-slate-800 font-medium">{r.contractorName}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono">{r.phone}</td>
                  <td className="px-4 py-3 text-right text-slate-900 font-medium tabular-nums">{fmt(r.amountTzs)}</td>
                  <td className="px-4 py-3 text-slate-500 uppercase text-[10px]">{r.payoutMethod}</td>
                  <td className="px-4 py-3">
                    <RowStatusBadge status={r.status} />
                    {r.payoutError && (
                      <p className="text-[10px] text-red-600 mt-0.5">{r.payoutError}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-[10px]">
                    {r.payoutReference ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
