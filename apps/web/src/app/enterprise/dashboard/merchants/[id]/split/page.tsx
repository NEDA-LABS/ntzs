'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

interface Merchant {
  id: string
  businessName: string | null
  handle: string
  settlePct: number
  lenderSplitPct: number
  lenderControlsSettlement: boolean
  withdrawalLimitTzs: number
  principalTzs: number | null
  interestRatePct: number | null
  interestTzs: number | null
  totalOwedTzs: number | null
  repaidTzs: number | null
  loanStatus: string | null
}

export default function MerchantControlsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [loading, setLoading] = useState(true)

  // Controls
  const [split, setSplit] = useState(0)
  const [withdrawalCap, setWithdrawalCap] = useState(0)
  const [settlementLocked, setSettlementLocked] = useState(false)
  const [savingControls, setSavingControls] = useState(false)
  const [controlsError, setControlsError] = useState('')
  const [controlsSaved, setControlsSaved] = useState(false)

  // Interest rate
  const [interestRate, setInterestRate] = useState(0)
  const [savingInterest, setSavingInterest] = useState(false)
  const [interestError, setInterestError] = useState('')
  const [interestSaved, setInterestSaved] = useState(false)

  useEffect(() => {
    fetch('/enterprise/api/lender/merchants')
      .then(r => r.json())
      .then(d => {
        const m = (d.merchants ?? []).find((x: Merchant) => x.id === id)
        if (m) {
          setMerchant(m)
          setSplit(m.lenderSplitPct)
          setWithdrawalCap(m.withdrawalLimitTzs)
          setSettlementLocked(m.lenderControlsSettlement)
          setInterestRate(m.interestRatePct ?? 0)
        }
      })
      .finally(() => setLoading(false))
  }, [id])

  async function handleSaveControls() {
    setControlsError(''); setSavingControls(true); setControlsSaved(false)
    try {
      const res = await fetch(`/enterprise/api/lender/merchants/${id}/controls`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lenderSplitPct: split, withdrawalLimitTzs: withdrawalCap, lenderControlsSettlement: settlementLocked }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save')
      setControlsSaved(true)
      setTimeout(() => setControlsSaved(false), 3000)
    } catch (err) {
      setControlsError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingControls(false) }
  }

  async function handleSaveInterest() {
    setInterestError(''); setSavingInterest(true); setInterestSaved(false)
    try {
      const res = await fetch(`/enterprise/api/lender/merchants/${id}/loan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interestRatePct: interestRate }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save')
      setInterestSaved(true)
      setTimeout(() => setInterestSaved(false), 3000)
    } catch (err) {
      setInterestError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingInterest(false)
    }
  }

  if (loading) return <div className="p-10 text-xs text-slate-600 animate-pulse">Loading...</div>
  if (!merchant) return <div className="p-10 text-xs text-slate-600">Merchant not found.</div>

  const EXAMPLE = 10000
  const lenderAmt = Math.floor(EXAMPLE * split / 100)
  const merchantAmt = Math.floor(EXAMPLE * merchant.settlePct / 100)
  const nedapayAmt = Math.floor(EXAMPLE * 0.005)
  const constraintOk = split + merchant.settlePct <= 99

  const computedInterestTzs = merchant.principalTzs ? Math.floor(merchant.principalTzs * interestRate / 100) : 0
  const computedTotalOwed = merchant.principalTzs ? merchant.principalTzs + computedInterestTzs : 0

  return (
    <div className="p-10 max-w-xl space-y-8">
      <div>
        <button onClick={() => router.back()} className="text-[10px] tracking-widest text-slate-600 uppercase hover:text-slate-400 transition-colors mb-6">← Back</button>
        <p className="text-[10px] tracking-widest text-slate-600 uppercase mb-1">Merchant Controls</p>
        <h1 className="text-2xl font-light text-slate-100">{merchant.businessName ?? merchant.handle}</h1>
      </div>

      {/* Loan summary */}
      {merchant.principalTzs && (
        <div className="border border-slate-800 bg-slate-900 p-5 grid grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Principal</p>
            <p className="text-sm font-semibold text-slate-100">TZS {fmt(merchant.principalTzs)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Repaid</p>
            <p className="text-sm font-semibold text-emerald-400">TZS {fmt(merchant.repaidTzs ?? 0)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Outstanding</p>
            <p className="text-sm font-semibold text-indigo-400">
              TZS {fmt((merchant.totalOwedTzs ?? merchant.principalTzs ?? 0) - (merchant.repaidTzs ?? 0))}
            </p>
          </div>
        </div>
      )}

      {/* ── 1. Repayment split ── */}
      <div className="border border-slate-800 bg-slate-900 p-6 space-y-5">
        <p className="text-[10px] tracking-widest text-slate-500 uppercase">1 · Repayment Split</p>

        <div className="flex items-center justify-between">
          <label className="text-xs text-slate-400">Your share of each collection</label>
          <span className="text-xl font-semibold text-indigo-400">{split}%</span>
        </div>

        <input
          type="range"
          min={0}
          max={95}
          value={split}
          onChange={e => setSplit(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
        <div className="flex justify-between text-[10px] text-slate-700">
          <span>0% (loan repaid / off)</span>
          <span>95% (max)</span>
        </div>

        {!constraintOk && (
          <p className="text-xs text-amber-400 border border-amber-900 bg-amber-950 px-3 py-2">
            Split ({split}%) + merchant settlement ({merchant.settlePct}%) exceeds 99%.
          </p>
        )}

        {/* Preview bar */}
        <div className="space-y-2 pt-1 border-t border-slate-800">
          <p className="text-[10px] tracking-widest text-slate-700 uppercase">Preview — TZS {fmt(EXAMPLE)}</p>
          {[
            { label: 'You (Ramani)', value: lenderAmt, color: 'bg-indigo-500' },
            { label: 'Merchant', value: merchantAmt, color: 'bg-slate-500' },
            { label: 'NEDApay (0.5%)', value: nedapayAmt, color: 'bg-slate-700' },
          ].map(row => (
            <div key={row.label} className="flex items-center gap-3">
              <div className="w-28 text-[10px] text-slate-500">{row.label}</div>
              <div className="flex-1 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div className={`h-full ${row.color} rounded-full transition-all`} style={{ width: `${(row.value / EXAMPLE) * 100}%` }} />
              </div>
              <div className="w-24 text-right text-xs text-slate-300">TZS {fmt(row.value)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 2. Interest rate ── */}
      {merchant.principalTzs && (
        <div className="border border-slate-800 bg-slate-900 p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] tracking-widest text-slate-500 uppercase">2 · Interest Rate</p>
              <p className="text-[10px] text-slate-600 mt-0.5">Flat rate — locked once repayments begin</p>
            </div>
            {(merchant.repaidTzs ?? 0) > 0 && (
              <span className="text-[9px] tracking-wider uppercase px-2 py-0.5 border text-zinc-500 border-zinc-800">Locked</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-2">Rate (%)</label>
              <input
                type="number"
                min={0}
                max={200}
                value={interestRate}
                onChange={e => setInterestRate(Number(e.target.value))}
                disabled={(merchant.repaidTzs ?? 0) > 0}
                className="w-full bg-black border border-slate-700 text-slate-200 text-sm px-3 py-2 focus:outline-none focus:border-indigo-500 disabled:opacity-40"
              />
            </div>
            {merchant.principalTzs && interestRate > 0 && (
              <div className="text-right">
                <p className="text-[10px] text-slate-600 mb-1">Interest</p>
                <p className="text-sm text-slate-300 tabular-nums">TZS {fmt(computedInterestTzs)}</p>
                <p className="text-[10px] text-slate-600 mt-1">Total owed</p>
                <p className="text-sm text-indigo-400 tabular-nums">TZS {fmt(computedTotalOwed)}</p>
              </div>
            )}
          </div>

          {interestError && <p className="text-xs text-red-400">{interestError}</p>}
          {interestSaved && <p className="text-xs text-emerald-400">Interest rate saved.</p>}

          <button
            onClick={handleSaveInterest}
            disabled={savingInterest || (merchant.repaidTzs ?? 0) > 0 || interestRate === (merchant.interestRatePct ?? 0)}
            className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 text-xs py-2.5 uppercase tracking-widest transition-colors"
          >
            {savingInterest ? 'Saving…' : 'Save Interest Rate'}
          </button>
        </div>
      )}

      {/* ── 3. Withdrawal cap ── */}
      <div className="border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div>
          <p className="text-[10px] tracking-widest text-slate-500 uppercase">3 · Withdrawal Cap</p>
          <p className="text-[10px] text-slate-600 mt-0.5">Max TZS the merchant can withdraw per request. Set 0 to disable withdrawals.</p>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-2">Cap (TZS)</label>
          <input
            type="number"
            min={0}
            value={withdrawalCap}
            onChange={e => setWithdrawalCap(Number(e.target.value))}
            placeholder="e.g. 500000"
            className="w-full bg-black border border-slate-700 text-slate-200 text-sm px-3 py-2 focus:outline-none focus:border-indigo-500"
          />
          {withdrawalCap > 0 && (
            <p className="text-[10px] text-slate-600 mt-1">
              Merchant can withdraw up to TZS {fmt(withdrawalCap)} per request.
            </p>
          )}
        </div>
      </div>

      {/* ── 4. Settlement lock ── */}
      <div className="border border-slate-800 bg-slate-900 p-6 space-y-4">
        <p className="text-[10px] tracking-widest text-slate-500 uppercase">4 · Settlement Lock</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-300">Lock merchant settlement controls</p>
            <p className="text-[10px] text-slate-600 mt-0.5">
              {settlementLocked
                ? 'Merchant cannot change their own settlement %.'
                : 'Merchant controls their own settlement.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettlementLocked(!settlementLocked)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settlementLocked ? 'bg-indigo-600' : 'bg-slate-700'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settlementLocked ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        {!settlementLocked && merchant.lenderControlsSettlement && (
          <p className="text-xs text-amber-400 border border-amber-900 bg-amber-950 px-3 py-2">
            Toggling this off will return settlement control to the merchant.
          </p>
        )}
      </div>

      {/* Save all controls */}
      {controlsError && <p className="border border-red-900 bg-red-950 px-4 py-2 text-xs text-red-400">{controlsError}</p>}
      {controlsSaved && <p className="border border-emerald-900 bg-emerald-950 px-4 py-2 text-xs text-emerald-400">Controls saved.</p>}

      <button
        onClick={handleSaveControls}
        disabled={savingControls || !constraintOk}
        className="w-full bg-indigo-600 py-3 text-xs font-semibold tracking-widest text-white uppercase transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {savingControls ? 'Saving…' : 'Save Controls'}
      </button>
    </div>
  )
}
