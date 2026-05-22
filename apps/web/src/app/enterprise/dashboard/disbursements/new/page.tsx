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
      <div className="p-10 max-w-lg space-y-6">
        <div>
          <p className="text-[10px] tracking-widest text-slate-600 uppercase mb-1">Disbursement Client</p>
          <h1 className="text-2xl font-light text-slate-100">Batch Created</h1>
        </div>

        <div className="border border-emerald-900 bg-emerald-950/30 p-6 space-y-4">
          <p className="text-xs text-emerald-400 tracking-wide">Batch ready — awaiting your bank transfer</p>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div><p className="text-[10px] text-slate-600 mb-0.5">Contractors</p><p className="text-slate-100">{result.contractorCount}</p></div>
            <div><p className="text-[10px] text-slate-600 mb-0.5">Disbursement Total</p><p className="text-slate-100">TZS {fmt(result.totalAmountTzs)}</p></div>
            <div><p className="text-[10px] text-slate-600 mb-0.5">Service Fee (0.75%)</p><p className="text-slate-400">TZS {fmt(result.serviceFeeTzs)}</p></div>
            <div><p className="text-[10px] text-slate-600 mb-0.5">Total Bank Transfer</p><p className="text-indigo-400 font-semibold">TZS {fmt(result.totalDue)}</p></div>
          </div>
        </div>

        <div className="border border-slate-800 bg-slate-900 p-5 space-y-3 text-xs text-slate-400">
          <p className="text-slate-200 text-sm font-medium">Next steps</p>
          <ol className="space-y-2 list-decimal list-inside">
            <li>Transfer <span className="text-indigo-400 font-semibold">TZS {fmt(result.totalDue)}</span> to NEDApay collection account</li>
            <li>Use batch ID <span className="font-mono text-slate-300">{result.batchId.slice(0, 8)}</span> as bank transfer reference</li>
            <li>Click "Confirm transfer initiated" below once sent</li>
          </ol>
        </div>

        {confirmError && <p className="text-xs text-red-400">{confirmError}</p>}

        <div className="flex gap-3">
          <button
            onClick={confirmTransfer}
            disabled={confirming}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs tracking-wide transition-colors"
          >
            {confirming ? 'Confirming…' : 'Confirm transfer initiated'}
          </button>
          <button
            onClick={() => router.push(`/enterprise/dashboard/disbursements/${result.batchId}`)}
            className="px-5 py-2 border border-slate-700 text-slate-400 hover:text-slate-200 text-xs tracking-wide transition-colors"
          >
            View batch later
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-10 space-y-8 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] tracking-widest text-slate-600 uppercase mb-1">Disbursement Client</p>
          <h1 className="text-2xl font-light text-slate-100">New Disbursement Batch</h1>
        </div>
        {step === 'preview' && (
          <button
            onClick={() => { setStep('upload'); setRows([]); setRowErrors([]); setBatchError(null); setFilename(null) }}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            ← Upload different file
          </button>
        )}
      </div>

      {step === 'upload' && (
        <div className="space-y-6">
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-700 hover:border-indigo-700 bg-slate-900 p-16 text-center cursor-pointer transition-colors"
          >
            <p className="text-sm text-slate-400 mb-2">Drop your CSV file here or click to browse</p>
            <p className="text-[10px] text-slate-600">Required columns: contractorName, phone, amountTzs — Optional: payoutMethod (mobile/eft), bankAccount</p>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleInputChange} />
          </div>

          {batchError && (
            <div className="border border-red-900 bg-red-950/30 p-4">
              <p className="text-xs text-red-400">{batchError}</p>
            </div>
          )}

          <div className="border border-slate-800 bg-slate-900 p-5 text-xs text-slate-500 space-y-2">
            <p className="text-slate-300 text-sm font-medium mb-3">BoT Sandbox Limits</p>
            <p>Maximum <span className="text-slate-300">20 contractors</span> per batch</p>
            <p>Maximum <span className="text-slate-300">TZS 1,000,000</span> per contractor per transaction</p>
            <p>Service fee: <span className="text-slate-300">0.75%</span> of total disbursement</p>
          </div>

          <div className="border border-slate-800 bg-slate-900 p-5">
            <p className="text-slate-300 text-sm font-medium mb-3">CSV Format</p>
            <pre className="text-[10px] text-slate-500 leading-5">
{`contractorName,phone,amountTzs,payoutMethod,bankAccount
John Doe,+255712345678,500000,mobile,
Jane Smith,+255754321098,750000,eft,ACC-1234-5678`}
            </pre>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'File', value: filename ?? '—', color: 'text-slate-300' },
              { label: 'Contractors', value: rows.length.toString(), color: rows.length > MAX_CONTRACTORS ? 'text-red-400' : 'text-slate-100' },
              { label: 'Disbursement Total', value: `TZS ${fmt(totalAmountTzs)}`, color: 'text-slate-100' },
              { label: 'Service Fee (0.75%)', value: `TZS ${fmt(serviceFeeTzs)}`, color: 'text-slate-400' },
            ].map(c => (
              <div key={c.label} className="border border-slate-800 bg-slate-900 p-4">
                <p className="text-[10px] tracking-widest text-slate-600 uppercase mb-1">{c.label}</p>
                <p className={`text-sm font-medium ${c.color} truncate`}>{c.value}</p>
              </div>
            ))}
          </div>

          <div className="border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] tracking-widest text-slate-600 uppercase">Total Bank Transfer Required</p>
            </div>
            <p className="text-xl font-semibold text-indigo-400">TZS {fmt(totalAmountTzs + serviceFeeTzs)}</p>
            <p className="text-[10px] text-slate-600 mt-1">Disbursement TZS {fmt(totalAmountTzs)} + Service fee TZS {fmt(serviceFeeTzs)}</p>
          </div>

          {rowErrors.length > 0 && (
            <div className="border border-red-900 bg-red-950/20 p-4 space-y-1">
              <p className="text-xs text-red-400 font-medium mb-2">Validation errors — fix CSV and re-upload</p>
              {rowErrors.map((e, i) => (
                <p key={i} className="text-[11px] text-red-300">Row {e.row}: {e.error}</p>
              ))}
            </div>
          )}

          <div className="border border-slate-800 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] tracking-widest text-slate-600 uppercase bg-slate-900">
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Contractor</th>
                  <th className="px-4 py-3 text-left">Phone</th>
                  <th className="px-4 py-3 text-right">Amount (TZS)</th>
                  <th className="px-4 py-3 text-left">Method</th>
                  <th className="px-4 py-3 text-left">Bank Account</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const hasError = errorRowNums.has(i + 1)
                  return (
                    <tr
                      key={i}
                      className={`border-b border-slate-800 last:border-0 ${hasError ? 'bg-red-950/20' : i % 2 === 0 ? 'bg-slate-950' : 'bg-slate-900'}`}
                    >
                      <td className={`px-4 py-2.5 ${hasError ? 'text-red-400' : 'text-slate-600'}`}>{i + 1}</td>
                      <td className={`px-4 py-2.5 ${hasError ? 'text-red-300' : 'text-slate-300'}`}>{r.contractorName || <span className="text-red-500 italic">missing</span>}</td>
                      <td className={`px-4 py-2.5 font-mono ${hasError ? 'text-red-300' : 'text-slate-400'}`}>{r.phone || <span className="text-red-500 italic">missing</span>}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${r.amountTzs > MAX_PER_TXN ? 'text-red-400' : 'text-slate-200'}`}>
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

          {confirmError && <p className="text-xs text-red-400">{confirmError}</p>}

          <div className="flex gap-3">
            <button
              onClick={submitBatch}
              disabled={confirming || rowErrors.length > 0}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs tracking-wide transition-colors"
            >
              {confirming ? 'Submitting…' : 'Submit batch'}
            </button>
            <button
              onClick={() => { setStep('upload'); setRows([]); setRowErrors([]); setBatchError(null); setFilename(null) }}
              className="px-5 py-2 border border-slate-700 text-slate-400 hover:text-slate-200 text-xs tracking-wide transition-colors"
            >
              Re-upload
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
