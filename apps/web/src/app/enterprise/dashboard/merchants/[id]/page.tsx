'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

import { RepaymentTrendChart } from '../../_components/charts'

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Loan {
  id: string
  principalTzs: number
  interestRatePct: number
  interestTzs: number
  totalOwedTzs: number
  repaidTzs: number
  disbursedTzs: number
  termDays: number | null
  dueAt: string | null
  status: string
  createdAt: string
}
interface Repayment {
  id: string
  amountTzs: number
  status: string
  txHash: string | null
  createdAt: string
}
interface Detail {
  merchant: {
    id: string
    businessName: string | null
    handle: string
    walletAddress: string
    settlePct: number
    lenderSplitPct: number
    lenderPendingTzs: number
    lenderControlsSettlement: boolean
    withdrawalLimitTzs: number
  }
  loan: Loan | null
  metrics: { drawnOutstanding: number; availableToDrawTzs: number; utilizationPct: number; interestRealizedTzs: number; daysToDue: number | null } | null
  repayments: Repayment[]
}

/** Bucket repayments into a monthly series for the trend chart. */
function monthlySeries(repayments: Repayment[]): Array<{ month: string; totalTzs: number; count: number }> {
  const map = new Map<string, { totalTzs: number; count: number }>()
  for (const r of repayments) {
    const d = new Date(r.createdAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const cur = map.get(key) ?? { totalTzs: 0, count: 0 }
    cur.totalTzs += r.amountTzs
    cur.count += 1
    map.set(key, cur)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({ month, ...v }))
}

export default function MerchantDetailPage() {
  const params = useParams<{ id: string }>()
  const [data, setData] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Send-capital form
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendSuccess, setSendSuccess] = useState('')

  const load = useCallback(() => {
    if (!params?.id) return
    return fetch(`/enterprise/api/lender/merchants/${params.id}`)
      .then(r => { if (!r.ok) { setNotFound(true); return null } return r.json() })
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [params?.id])

  useEffect(() => { load() }, [load])

  async function handleDisburse(e: React.FormEvent) {
    e.preventDefault()
    setSending(true); setSendError(''); setSendSuccess('')
    try {
      const res = await fetch(`/enterprise/api/lender/merchants/${params.id}/disburse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountTzs: Number(amount) }),
      })
      const json = await res.json()
      if (!res.ok) { setSendError(json.error || 'Disbursement failed'); return }
      setSendSuccess(`Sent ${Number(amount).toLocaleString()} nTZS to the merchant's wallet.`)
      setAmount('')
      await load()
    } catch { setSendError('Network error') }
    finally { setSending(false) }
  }

  if (loading) {
    return (
      <div className="p-10">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-40 bg-gray-200 rounded" />
          <div className="h-28 bg-gray-200 rounded-lg" />
          <div className="h-48 bg-gray-200 rounded-lg" />
        </div>
      </div>
    )
  }

  if (notFound || !data) {
    return (
      <div className="p-10 space-y-4">
        <Link href="/enterprise/dashboard/loans" className="text-[10px] tracking-widest text-indigo-600 uppercase hover:text-indigo-700">← Back</Link>
        <p className="text-sm text-gray-500">Merchant not found or not linked to your account.</p>
      </div>
    )
  }

  const { merchant, loan, metrics, repayments } = data
  const series = monthlySeries(repayments)
  const recoveryPct = loan && loan.totalOwedTzs > 0 ? Math.round(loan.repaidTzs / loan.totalOwedTzs * 100) : 0

  return (
    <div className="p-10 space-y-8 max-w-4xl">
      <div>
        <Link href="/enterprise/dashboard/loans" className="text-[10px] tracking-widest text-indigo-600 uppercase hover:text-indigo-700">← Loan Agreements</Link>
        <div className="flex items-end justify-between mt-2">
          <div>
            <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-1">Merchant</p>
            <h1 className="text-2xl font-light text-gray-900">{merchant.businessName ?? merchant.handle}</h1>
            <p className="text-[10px] text-gray-400 font-mono mt-1">{merchant.walletAddress}</p>
          </div>
          <Link
            href={`/enterprise/dashboard/merchants/${merchant.id}/split`}
            className="border border-gray-300 px-4 py-2 text-[10px] tracking-widest text-gray-500 uppercase hover:border-indigo-400 hover:text-indigo-600 transition-colors rounded"
          >
            Manage Terms
          </Link>
        </div>
      </div>

      {!loan ? (
        <div className="border border-gray-200 bg-white rounded-lg shadow-sm p-8 text-center">
          <p className="text-sm text-gray-500">No active loan agreement with this merchant.</p>
          <Link href={`/enterprise/dashboard/merchants/${merchant.id}/split`} className="text-xs text-indigo-600 hover:underline mt-2 inline-block">Set up loan terms →</Link>
        </div>
      ) : (
        <>
          {/* Loan summary metrics */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              { label: 'Principal', value: `TZS ${fmt(loan.principalTzs)}`, sub: loan.interestRatePct > 0 ? `${loan.interestRatePct}% interest` : 'interest-free', accent: 'slate' },
              { label: 'Outstanding', value: `TZS ${fmt(metrics?.drawnOutstanding ?? 0)}`, sub: `TZS ${fmt(metrics?.availableToDrawTzs ?? 0)} still drawable`, accent: 'indigo' },
              { label: 'Interest Earned', value: `TZS ${fmt(metrics?.interestRealizedTzs ?? 0)}`, sub: `of ${fmt(loan.interestTzs)} contracted`, accent: 'green' },
              {
                label: 'Term',
                value: loan.termDays ? `${loan.termDays}d` : '—',
                sub: loan.dueAt ? `due ${fmtDate(loan.dueAt)}${metrics?.daysToDue != null ? ` (${metrics.daysToDue}d)` : ''}` : 'no term set',
                accent: metrics?.daysToDue != null && metrics.daysToDue < 0 ? 'red' : 'slate',
              },
            ].map(card => (
              <div key={card.label} className="border border-gray-200 bg-white rounded-lg shadow-sm p-5">
                <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-3">{card.label}</p>
                <p className={`text-lg font-semibold ${card.accent === 'indigo' ? 'text-indigo-600' : card.accent === 'green' ? 'text-emerald-600' : card.accent === 'red' ? 'text-red-600' : 'text-gray-900'}`}>{card.value}</p>
                <p className="text-[10px] text-gray-400 mt-1">{card.sub}</p>
              </div>
            ))}
          </div>

          {/* Send capital */}
          <div className="border border-indigo-200 bg-indigo-50/40 rounded-lg shadow-sm p-6">
            <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-1">Send Capital</p>
            <p className="text-[11px] text-gray-500 mb-4">
              Send nTZS from your treasury to this merchant&apos;s wallet — up to <span className="text-indigo-600 font-medium">TZS {fmt(metrics?.availableToDrawTzs ?? 0)}</span> remaining facility. They hold nTZS and cash out to mobile money themselves when needed.
            </p>
            <form onSubmit={handleDisburse} className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[160px]">
                <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1">Amount (nTZS)</label>
                <input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  required
                  placeholder="e.g. 200000"
                  className="w-full bg-white border border-gray-300 text-gray-900 text-sm px-3 py-2 rounded focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={sending || !amount}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs px-5 py-2.5 uppercase tracking-widest transition-colors rounded"
              >
                {sending ? 'Sending…' : 'Send nTZS'}
              </button>
            </form>
            {sendError && <p className="text-xs text-red-600 mt-3 border border-red-200 bg-red-50 px-3 py-2 rounded">{sendError}</p>}
            {sendSuccess && <p className="text-xs text-emerald-700 mt-3 border border-emerald-200 bg-emerald-50 px-3 py-2 rounded">{sendSuccess}</p>}
          </div>

          {/* Progress bars */}
          <div className="border border-gray-200 bg-white rounded-lg shadow-sm p-6 space-y-4">
            <div>
              <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Recovery (of total owed)</span><span>{recoveryPct}%</span></div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(100, recoveryPct)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Facility utilization</span><span>{Math.round(metrics?.utilizationPct ?? 0)}%</span></div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${Math.min(100, metrics?.utilizationPct ?? 0)}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 pt-2 text-xs">
              <div><p className="text-[10px] text-gray-400 mb-0.5">Lender split</p><p className="text-indigo-600 font-medium">{merchant.lenderSplitPct}%</p></div>
              <div><p className="text-[10px] text-gray-400 mb-0.5">Pending to you</p><p className="text-gray-700 font-medium">TZS {fmt(merchant.lenderPendingTzs)}</p></div>
              <div><p className="text-[10px] text-gray-400 mb-0.5">Settlement</p><p className="text-gray-700 font-medium">{merchant.lenderControlsSettlement ? 'Lender-controlled' : 'Merchant'}</p></div>
            </div>
          </div>

          {/* Repayment trend */}
          {series.length > 0 && (
            <div className="border border-gray-200 bg-white rounded-lg shadow-sm p-6">
              <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-4">Repayment Inflow</p>
              <RepaymentTrendChart data={series} />
            </div>
          )}
        </>
      )}

      {/* Repayment history */}
      <div>
        <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-4">Repayment History</p>
        {repayments.length === 0 ? (
          <div className="border border-gray-100 rounded-lg p-8 text-center">
            <p className="text-xs text-gray-400">No repayments from this merchant yet.</p>
          </div>
        ) : (
          <div className="border border-gray-200 bg-white rounded-lg shadow-sm overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  {['Date', 'Amount', 'Status', 'Tx'].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-[10px] tracking-widest text-gray-400 uppercase font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {repayments.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-gray-500">{fmtDate(r.createdAt)}</td>
                    <td className="px-5 py-3 font-semibold text-emerald-600 tabular-nums">+TZS {fmt(r.amountTzs)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border rounded ${
                        r.status === 'completed' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
                        r.status === 'failed' ? 'text-red-700 bg-red-50 border-red-200' :
                        'text-gray-500 bg-gray-100 border-gray-200'
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-5 py-3">
                      {r.txHash ? (
                        <a href={`https://basescan.org/tx/${r.txHash}`} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-600 hover:text-indigo-700 font-mono">
                          {r.txHash.slice(0, 8)}…{r.txHash.slice(-4)}
                        </a>
                      ) : <span className="text-gray-300">—</span>}
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
