'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface ParsedRow {
  contractorName: string
  phone: string
  amountTzs: number
  payoutMethod: 'mobile' | 'eft'
  bankAccount: string
}

interface RowError {
  row: number
  error: string
}

interface UploadResult {
  batchId: string
  contractorCount: number
  totalAmountTzs: number
  serviceFeeTzs: number
  totalDue: number
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    return row
  }).filter(r => Object.values(r).some(v => v !== ''))
}

const MAX_CONTRACTORS = 20
const MAX_PER_TXN = 1_000_000

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

function validateRows(rows: ParsedRow[]): RowError[] {
  const errors: RowError[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rowNum = i + 1
    if (!r.contractorName?.trim()) errors.push({ row: rowNum, error: 'Missing name' })
    if (!r.phone?.trim()) errors.push({ row: rowNum, error: 'Missing phone' })
    if (!r.amountTzs || isNaN(r.amountTzs) || r.amountTzs <= 0) errors.push({ row: rowNum, error: 'Invalid amount' })
    if (r.amountTzs > MAX_PER_TXN) errors.push({ row: rowNum, error: `Exceeds TZS 1M limit` })
    if (r.payoutMethod === 'eft' && !r.bankAccount?.trim()) errors.push({ row: rowNum, error: 'Bank account required for EFT' })
  }
  return errors
}

export default function NewBatchPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [filename, setFilename] = useState<string | null>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [rowErrors, setRowErrors] = useState<RowError[]>([])
  const [batchError, setBatchError] = useState<string | null>(null)
  const [step, setStep] = useState<'upload' | 'preview' | 'confirming' | 'done'>('upload')
  const [result, setResult] = useState<UploadResult | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [dragging, setDragging] = useState(false)

  function handleFile(file: File) {
    setFilename(file.name)
    setBatchError(null)
    setRowErrors([])

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const rawRows = parseCsv(text)
        if (rawRows.length > MAX_CONTRACTORS) {
          setBatchError(`Batch exceeds BoT sandbox limit of ${MAX_CONTRACTORS} contractors (got ${rawRows.length})`)
          setRows([])
          setStep('upload')
          return
        }
        const parsed: ParsedRow[] = rawRows.map(r => ({
          contractorName: r['contractorName'] ?? r['contractor_name'] ?? r['name'] ?? '',
          phone:          r['phone'] ?? r['phoneNumber'] ?? r['phone_number'] ?? '',
          amountTzs:      parseFloat(r['amountTzs'] ?? r['amount_tzs'] ?? r['amount'] ?? '0'),
          payoutMethod:   (r['payoutMethod'] ?? r['payout_method'] ?? 'mobile') as 'mobile' | 'eft',
          bankAccount:    r['bankAccount'] ?? r['bank_account'] ?? '',
        }))
        const errs = validateRows(parsed)
        setRows(parsed)
        setRowErrors(errs)
        setStep('preview')
      } catch {
        setBatchError('Failed to parse CSV — check the file format.')
        setStep('upload')
      }
    }
    reader.readAsText(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  async function submitBatch() {
    setConfirming(true)
    setConfirmError(null)
    try {
      const res = await fetch('/enterprise/api/disbursements/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, filename }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.rowErrors) {
          setRowErrors(data.rowErrors)
          setConfirmError('Server validation found errors — see rows below.')
        } else {
          setConfirmError(data.error ?? 'Upload failed')
        }
        return
      }
      setResult(data)
      setStep('done')
    } catch {
      setConfirmError('Network error — please try again.')
    } finally {
      setConfirming(false)
    }
  }

  async function confirmTransfer() {
    if (!result) return
    setConfirming(true)
    setConfirmError(null)
    try {
      const res = await fetch(`/enterprise/api/disbursements/${result.batchId}/confirm`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        setConfirmError(data.error ?? 'Confirm failed')
        return
      }
      router.push(`/enterprise/dashboard/disbursements/${result.batchId}`)
    } catch {
      setConfirmError('Network error — please try again.')
    } finally {
      setConfirming(false)
    }
  }

  const errorRowNums = new Set(rowErrors.map(e => e.row))
  const totalAmountTzs = rows.reduce((s, r) => s + (r.amountTzs || 0), 0)
  const serviceFeeTzs = Math.ceil(totalAmountTzs * 0.0075)

  if (step === 'done' && result) {
    return (
      <div className="min-h-full">
        <div className="bg-white border-b border-slate-200 px-10 py-6">
          <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1.5">Disbursement Client</p>
          <h1 className="text-2xl font-light text-slate-900 tracking-tight">Batch Created</h1>
        </div>

        <div className="p-10 max-w-lg space-y-5">
          <div className="bg-white border border-emerald-200 border-l-4 border-l-emerald-500 p-6 shadow-sm space-y-4 rounded-sm">
            <p className="text-xs text-emerald-700 font-medium tracking-wide">Batch ready — awaiting your bank transfer</p>
            <div className="grid grid-cols-2 gap-4 text-xs pt-1">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Contractors</p>
                <p className="text-slate-900 font-medium">{result.contractorCount}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Disbursement Total</p>
                <p className="text-slate-900 font-medium">TZS {fmt(result.totalAmountTzs)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Service Fee (0.75%)</p>
                <p className="text-slate-500">TZS {fmt(result.serviceFeeTzs)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Total Bank Transfer</p>
                <p className="text-indigo-700 font-semibold">TZS {fmt(result.totalDue)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 p-5 space-y-3 text-xs text-slate-600 shadow-sm rounded-sm">
            <p className="text-slate-900 text-sm font-medium">Next steps</p>
            <ol className="space-y-2 list-decimal list-inside">
              <li>Transfer <span className="text-indigo-700 font-semibold">TZS {fmt(result.totalDue)}</span> to NEDApay collection account</li>
              <li>Use batch ID <span className="font-mono text-slate-700 bg-slate-100 px-1 py-0.5">{result.batchId.slice(0, 8)}</span> as bank transfer reference</li>
              <li>Click &quot;Confirm transfer initiated&quot; below once sent</li>
            </ol>
          </div>

          {confirmError && (
            <div className="bg-red-50 border border-red-200 px-4 py-3 rounded-sm">
              <p className="text-xs text-red-700">{confirmError}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={confirmTransfer}
              disabled={confirming}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs tracking-wide transition-colors rounded-sm"
            >
              {confirming ? 'Confirming…' : 'Confirm transfer initiated'}
            </button>
            <button
              onClick={() => router.push(`/enterprise/dashboard/disbursements/${result.batchId}`)}
              className="px-5 py-2.5 border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 text-xs tracking-wide transition-colors rounded-sm"
            >
              View batch later
            </button>
          </div>
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
            <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1.5">Disbursement Client</p>
            <h1 className="text-2xl font-light text-slate-900 tracking-tight">New Disbursement Batch</h1>
          </div>
          {step === 'preview' && (
            <button
              onClick={() => { setStep('upload'); setRows([]); setRowErrors([]); setBatchError(null); setFilename(null) }}
              className="text-xs text-slate-500 hover:text-slate-800 transition-colors"
            >
              ← Upload different file
            </button>
          )}
        </div>
      </div>

      <div className="p-10 space-y-6 max-w-4xl">

        {step === 'upload' && (
          <div className="space-y-5">
            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onClick={() => fileRef.current?.click()}
              className={`bg-white border-2 border-dashed rounded-sm p-16 text-center cursor-pointer transition-all ${
                dragging
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
              }`}
            >
              <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="text-sm text-slate-700 mb-1">Drop your CSV file here or click to browse</p>
              <p className="text-[11px] text-slate-400">Required: contractorName, phone, amountTzs — Optional: payoutMethod (mobile/eft), bankAccount</p>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleInputChange} />
            </div>

            {batchError && (
              <div className="bg-red-50 border border-red-200 border-l-4 border-l-red-500 px-4 py-3 rounded-sm">
                <p className="text-xs text-red-700">{batchError}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {/* BoT limits */}
              <div className="bg-white border border-slate-200 border-l-4 border-l-amber-400 p-5 shadow-sm rounded-sm">
                <p className="text-slate-900 text-sm font-medium mb-3">BoT Sandbox Limits</p>
                <div className="space-y-2 text-xs text-slate-600">
                  <p>Maximum <span className="text-slate-900 font-medium">20 contractors</span> per batch</p>
                  <p>Maximum <span className="text-slate-900 font-medium">TZS 1,000,000</span> per contractor per transaction</p>
                  <p>Service fee: <span className="text-slate-900 font-medium">0.75%</span> of total disbursement</p>
                </div>
              </div>

              {/* CSV format */}
              <div className="bg-white border border-slate-200 p-5 shadow-sm rounded-sm">
                <p className="text-slate-900 text-sm font-medium mb-3">CSV Format</p>
                <pre className="text-[10px] text-slate-500 leading-5 bg-slate-50 border border-slate-100 rounded p-3 overflow-x-auto">
{`contractorName,phone,amountTzs,payoutMethod,bankAccount
John Doe,+255712345678,500000,mobile,
Jane Smith,+255754321098,750000,eft,ACC-1234-5678`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-5">
            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'File', value: filename ?? '—', mono: true },
                { label: 'Contractors', value: rows.length.toString(), warn: rows.length > MAX_CONTRACTORS },
                { label: 'Disbursement Total', value: `TZS ${fmt(totalAmountTzs)}` },
                { label: 'Service Fee (0.75%)', value: `TZS ${fmt(serviceFeeTzs)}`, muted: true },
              ].map(c => (
                <div key={c.label} className="bg-white border border-slate-200 p-4 shadow-sm rounded-sm">
                  <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1">{c.label}</p>
                  <p className={`text-sm font-medium truncate ${c.warn ? 'text-red-600' : c.muted ? 'text-slate-400' : 'text-slate-900'} ${c.mono ? 'font-mono text-xs' : ''}`}>
                    {c.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Total due */}
            <div className="bg-white border border-slate-200 border-l-4 border-l-indigo-500 px-5 py-4 shadow-sm rounded-sm">
              <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1">Total Bank Transfer Required</p>
              <p className="text-xl font-semibold text-indigo-700 tabular-nums">TZS {fmt(totalAmountTzs + serviceFeeTzs)}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Disbursement TZS {fmt(totalAmountTzs)} + Service fee TZS {fmt(serviceFeeTzs)}</p>
            </div>

            {/* Validation errors */}
            {rowErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 border-l-4 border-l-red-500 p-4 space-y-1 rounded-sm">
                <p className="text-xs text-red-700 font-medium mb-2">Validation errors — fix CSV and re-upload</p>
                {rowErrors.map((e, i) => (
                  <p key={i} className="text-[11px] text-red-600">Row {e.row}: {e.error}</p>
                ))}
              </div>
            )}

            {/* Preview table */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-sm overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {['#', 'Contractor', 'Phone', 'Amount (TZS)', 'Method', 'Bank Account'].map(h => (
                      <th key={h} className={`px-4 py-3 text-[10px] tracking-widest text-slate-400 uppercase font-medium ${h === 'Amount (TZS)' ? 'text-right' : 'text-left'}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => {
                    const hasError = errorRowNums.has(i + 1)
                    return (
                      <tr key={i} className={hasError ? 'bg-red-50' : 'hover:bg-slate-50 transition-colors'}>
                        <td className={`px-4 py-2.5 ${hasError ? 'text-red-500' : 'text-slate-400'}`}>{i + 1}</td>
                        <td className={`px-4 py-2.5 font-medium ${hasError ? 'text-red-700' : 'text-slate-800'}`}>
                          {r.contractorName || <span className="text-red-500 italic font-normal">missing</span>}
                        </td>
                        <td className={`px-4 py-2.5 font-mono ${hasError ? 'text-red-600' : 'text-slate-600'}`}>
                          {r.phone || <span className="text-red-500 italic font-normal">missing</span>}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${r.amountTzs > MAX_PER_TXN ? 'text-red-600' : 'text-slate-900'}`}>
                          {fmt(r.amountTzs || 0)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 uppercase text-[10px]">{r.payoutMethod}</td>
                        <td className="px-4 py-2.5 text-slate-500 font-mono">{r.bankAccount || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {confirmError && (
              <div className="bg-red-50 border border-red-200 px-4 py-3 rounded-sm">
                <p className="text-xs text-red-700">{confirmError}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={submitBatch}
                disabled={confirming || rowErrors.length > 0}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs tracking-wide transition-colors rounded-sm"
              >
                {confirming ? 'Submitting…' : 'Submit batch'}
              </button>
              <button
                onClick={() => { setStep('upload'); setRows([]); setRowErrors([]); setBatchError(null); setFilename(null) }}
                className="px-5 py-2.5 border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 text-xs tracking-wide transition-colors rounded-sm"
              >
                Re-upload
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
