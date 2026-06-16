'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Recipient {
  id: number
  contractorName: string
  phone: string
  amount: string // kept as string for smooth input; parsed on submit
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

const MAX_CONTRACTORS = 20
const MAX_PER_TXN = 1_000_000
const SERVICE_FEE_PCT = 0.0075

// NEDApay collection account funds are transferred to before a batch is paid
// out. Single source of truth — keep in sync with the batch-detail page.
const COLLECTION_ACCOUNT = {
  bank: 'Selcom Microfinance Bank',
  accountName: 'Neda Labs Limited',
  accountNumber: '55271 07446 681',
  swift: 'ACTZTZTZ',
}

let nextId = 1
function blankRecipient(): Recipient {
  return { id: nextId++, contractorName: '', phone: '', amount: '', payoutMethod: 'mobile', bankAccount: '' }
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
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

/** Per-recipient validation message (null if the row is valid). */
function rowError(r: Recipient): string | null {
  const amount = Number(r.amount)
  if (!r.contractorName.trim()) return 'Name required'
  if (!r.phone.trim()) return 'Phone required'
  if (!r.amount || isNaN(amount) || amount <= 0) return 'Enter a valid amount'
  if (amount > MAX_PER_TXN) return 'Exceeds TZS 1,000,000 limit'
  if (r.payoutMethod === 'eft' && !r.bankAccount.trim()) return 'Bank account required for EFT'
  return null
}

export default function NewBatchPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [recipients, setRecipients] = useState<Recipient[]>(() => [blankRecipient()])
  const [batchError, setBatchError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState<'build' | 'done'>('build')
  const [result, setResult] = useState<UploadResult | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  function update(id: number, patch: Partial<Recipient>) {
    setRecipients(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }
  function addRow() {
    setBatchError(null)
    setRecipients(rs => (rs.length >= MAX_CONTRACTORS ? rs : [...rs, blankRecipient()]))
  }
  function removeRow(id: number) {
    setRecipients(rs => (rs.length === 1 ? [blankRecipient()] : rs.filter(r => r.id !== id)))
  }

  function importCsv(file: File) {
    setBatchError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const raw = parseCsv(e.target?.result as string)
        const imported: Recipient[] = raw.map(r => ({
          id: nextId++,
          contractorName: r['contractorName'] ?? r['contractor_name'] ?? r['name'] ?? '',
          phone: r['phone'] ?? r['phoneNumber'] ?? r['phone_number'] ?? '',
          amount: String(r['amountTzs'] ?? r['amount_tzs'] ?? r['amount'] ?? '').replace(/[^\d]/g, ''),
          payoutMethod: ((r['payoutMethod'] ?? r['payout_method'] ?? 'mobile').toLowerCase() === 'eft' ? 'eft' : 'mobile') as 'mobile' | 'eft',
          bankAccount: r['bankAccount'] ?? r['bank_account'] ?? '',
        }))
        // Merge into existing non-empty rows so a CSV adds to (not wipes) the list.
        const existing = recipients.filter(r => r.contractorName.trim() || r.phone.trim() || r.amount.trim())
        const merged = [...existing, ...imported]
        if (merged.length > MAX_CONTRACTORS) {
          setBatchError(`Importing ${imported.length} would exceed the ${MAX_CONTRACTORS}-recipient limit (you'd have ${merged.length}).`)
          return
        }
        setRecipients(merged.length ? merged : [blankRecipient()])
      } catch {
        setBatchError('Could not read that CSV — check the format.')
      }
    }
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function submitBatch() {
    setSubmitting(true)
    setBatchError(null)
    try {
      const rows = recipients.map(r => ({
        contractorName: r.contractorName.trim(),
        phone: r.phone.trim(),
        amountTzs: Number(r.amount),
        payoutMethod: r.payoutMethod,
        bankAccount: r.bankAccount.trim(),
      }))
      const res = await fetch('/enterprise/api/disbursements/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, filename: null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setBatchError(data.error ?? 'Upload failed')
        return
      }
      setResult(data)
      setStep('done')
    } catch {
      setBatchError('Network error — please try again.')
    } finally {
      setSubmitting(false)
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

  const filled = recipients.filter(r => r.contractorName.trim() || r.phone.trim() || r.amount.trim())
  const totalAmountTzs = recipients.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const serviceFeeTzs = Math.ceil(totalAmountTzs * SERVICE_FEE_PCT)
  const totalDue = totalAmountTzs + serviceFeeTzs
  const errors = recipients.map(r => rowError(r))
  const hasErrors = filled.length === 0 || errors.some(e => e !== null) || recipients.length > MAX_CONTRACTORS

  // ── Done / funding step ────────────────────────────────────────────────
  if (step === 'done' && result) {
    const ref = result.batchId.slice(0, 8).toUpperCase()
    return (
      <div className="min-h-full">
        <div className="bg-white border-b border-slate-200 px-10 py-6">
          <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1.5">Disbursement Client</p>
          <h1 className="text-2xl font-light text-slate-900 tracking-tight">Batch Created — Fund It</h1>
        </div>

        <div className="p-10 max-w-xl space-y-5">
          <div className="bg-white border border-emerald-200 border-l-4 border-l-emerald-500 p-6 shadow-sm space-y-4 rounded-sm">
            <p className="text-xs text-emerald-700 font-medium tracking-wide">Batch saved — awaiting your bank transfer</p>
            <div className="grid grid-cols-2 gap-4 text-xs pt-1">
              <div><p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Recipients</p><p className="text-slate-900 font-medium">{result.contractorCount}</p></div>
              <div><p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Disbursement Total</p><p className="text-slate-900 font-medium">TZS {fmt(result.totalAmountTzs)}</p></div>
              <div><p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Service Fee (0.75%)</p><p className="text-slate-500">TZS {fmt(result.serviceFeeTzs)}</p></div>
              <div><p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Total Bank Transfer</p><p className="text-indigo-700 font-semibold">TZS {fmt(result.totalDue)}</p></div>
            </div>
          </div>

          {/* Collection account */}
          <div className="bg-white border border-slate-200 p-6 space-y-4 shadow-sm rounded-sm">
            <p className="text-slate-900 text-sm font-medium">Transfer to the NEDApay collection account</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
              <Field label="Bank" value={COLLECTION_ACCOUNT.bank} />
              <Field label="Account Name" value={COLLECTION_ACCOUNT.accountName} />
              <Field label="Account Number" value={COLLECTION_ACCOUNT.accountNumber} mono />
              <Field label="SWIFT" value={COLLECTION_ACCOUNT.swift} mono />
              <Field label="Amount" value={`TZS ${fmt(result.totalDue)}`} accent />
              <Field label="Reference (required)" value={ref} mono accent />
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
              Use reference <span className="font-mono text-slate-600">{ref}</span> so we can match your transfer to this batch. Payouts begin once funds are confirmed.
            </p>
          </div>

          {confirmError && (
            <div className="bg-red-50 border border-red-200 px-4 py-3 rounded-sm"><p className="text-xs text-red-700">{confirmError}</p></div>
          )}

          <div className="flex gap-3">
            <button onClick={confirmTransfer} disabled={confirming} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs tracking-wide transition-colors rounded-sm">
              {confirming ? 'Confirming…' : 'Confirm transfer initiated'}
            </button>
            <button onClick={() => router.push(`/enterprise/dashboard/disbursements/${result.batchId}`)} className="px-5 py-2.5 border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 text-xs tracking-wide transition-colors rounded-sm">
              View batch later
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Build step ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-slate-200 px-10 py-6">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1.5">Disbursement Client</p>
            <h1 className="text-2xl font-light text-slate-900 tracking-tight">New Disbursement Batch</h1>
          </div>
          <div className="flex items-center gap-3">
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importCsv(f) }} />
            <button onClick={() => fileRef.current?.click()} className="text-xs text-slate-500 hover:text-indigo-600 transition-colors border border-slate-200 hover:border-indigo-300 px-3 py-1.5 rounded-sm">
              ↑ Import from CSV
            </button>
          </div>
        </div>
      </div>

      <div className="p-10 space-y-5 max-w-5xl">

        <p className="text-xs text-slate-500">
          Add recipients below, or import a CSV to fill the list. Up to {MAX_CONTRACTORS} recipients, max TZS 1,000,000 each.
        </p>

        {batchError && (
          <div className="bg-red-50 border border-red-200 border-l-4 border-l-red-500 px-4 py-3 rounded-sm"><p className="text-xs text-red-700">{batchError}</p></div>
        )}

        {/* Editable recipients table */}
        <div className="bg-white border border-slate-200 shadow-sm rounded-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['#', 'Recipient name', 'Phone', 'Amount (TZS)', 'Method', 'Bank account', ''].map((h, i) => (
                  <th key={i} className={`px-3 py-3 text-[10px] tracking-widest text-slate-400 uppercase font-medium ${h === 'Amount (TZS)' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recipients.map((r, i) => {
                const err = errors[i]
                return (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2 text-slate-400 tabular-nums pt-4">{i + 1}</td>
                    <td className="px-3 py-2">
                      <input value={r.contractorName} onChange={e => update(r.id, { contractorName: e.target.value })} placeholder="Full name"
                        className="w-full border border-slate-200 rounded px-2 py-1.5 text-slate-800 focus:border-indigo-400 focus:outline-none" />
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.phone} onChange={e => update(r.id, { phone: e.target.value })} placeholder="+255…"
                        className="w-full border border-slate-200 rounded px-2 py-1.5 font-mono text-slate-700 focus:border-indigo-400 focus:outline-none" />
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.amount} inputMode="numeric" onChange={e => update(r.id, { amount: e.target.value.replace(/[^\d]/g, '') })} placeholder="0"
                        className="w-full border border-slate-200 rounded px-2 py-1.5 text-right tabular-nums text-slate-900 focus:border-indigo-400 focus:outline-none" />
                    </td>
                    <td className="px-3 py-2">
                      <select value={r.payoutMethod} onChange={e => update(r.id, { payoutMethod: e.target.value as 'mobile' | 'eft' })}
                        className="w-full border border-slate-200 rounded px-2 py-1.5 text-slate-700 bg-white focus:border-indigo-400 focus:outline-none">
                        <option value="mobile">Mobile</option>
                        <option value="eft">Bank (EFT)</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.bankAccount} disabled={r.payoutMethod !== 'eft'} onChange={e => update(r.id, { bankAccount: e.target.value })}
                        placeholder={r.payoutMethod === 'eft' ? 'Account no.' : '—'}
                        className="w-full border border-slate-200 rounded px-2 py-1.5 font-mono text-slate-700 focus:border-indigo-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-300" />
                      {err && <p className="text-[10px] text-red-500 mt-1">{err}</p>}
                    </td>
                    <td className="px-2 py-2 pt-3 text-right">
                      <button onClick={() => removeRow(r.id)} className="text-slate-300 hover:text-red-500 transition-colors text-base leading-none" title="Remove">×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-3 py-2">
            <button onClick={addRow} disabled={recipients.length >= MAX_CONTRACTORS}
              className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              + Add recipient
            </button>
            {recipients.length >= MAX_CONTRACTORS && <span className="ml-3 text-[11px] text-amber-600">Reached the {MAX_CONTRACTORS}-recipient limit.</span>}
          </div>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: 'Recipients', value: String(filled.length) },
            { label: 'Disbursement Total', value: `TZS ${fmt(totalAmountTzs)}` },
            { label: 'Service Fee (0.75%)', value: `TZS ${fmt(serviceFeeTzs)}`, muted: true },
            { label: 'Total Bank Transfer', value: `TZS ${fmt(totalDue)}`, accent: true },
          ].map(c => (
            <div key={c.label} className={`bg-white border border-slate-200 p-4 shadow-sm rounded-sm ${c.accent ? 'border-l-4 border-l-indigo-500' : ''}`}>
              <p className="text-[10px] tracking-widest text-slate-400 uppercase mb-1">{c.label}</p>
              <p className={`text-sm font-semibold tabular-nums ${c.accent ? 'text-indigo-700' : c.muted ? 'text-slate-400' : 'text-slate-900'}`}>{c.value}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button onClick={submitBatch} disabled={submitting || hasErrors}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs tracking-wide transition-colors rounded-sm">
            {submitting ? 'Creating…' : 'Create batch'}
          </button>
          {hasErrors && filled.length > 0 && (
            <span className="self-center text-[11px] text-slate-400">Fix the highlighted rows to continue.</span>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`${mono ? 'font-mono' : ''} ${accent ? 'text-indigo-700 font-semibold' : 'text-slate-900'}`}>{value}</p>
    </div>
  )
}
