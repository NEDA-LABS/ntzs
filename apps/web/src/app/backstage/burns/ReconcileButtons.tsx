'use client'

import { useState } from 'react'

interface ReconcileResult {
  ok?: boolean
  action?: string
  error?: string
  message?: string
  rail?: string
  payoutReference?: string
  settled?: string
  remintTxHash?: string
  failureReason?: string
}

/**
 * Per-row resolution for a burn stuck in reconcile_required.
 *
 * Deliberately calls the admin reconcile API route (not a server action) so
 * the buttons exercise the exact same guarded money path an engineer's curl
 * would — one code path for the movement, one audit trail. Same principle as
 * SpendTestForm.
 *
 * "Mint back" = force_revert (operator has confirmed with the PSPs that no
 * payout was dispatched). "Re-dispatch" = pay the ORIGINAL withdrawal through
 * the failover rail — no new burn, no user retry.
 */
export default function ReconcileButtons({ burnId }: { burnId: string }) {
  const [busy, setBusy] = useState<'force_revert' | 'redispatch' | null>(null)
  const [result, setResult] = useState<ReconcileResult | null>(null)

  const run = async (action: 'force_revert' | 'redispatch') => {
    const confirmText =
      action === 'force_revert'
        ? 'Mint this burn back to the source wallet? Only do this after confirming with the PSPs that NO payout was dispatched.'
        : 'Pay the original withdrawal now through the working rail? This moves real money to the recipient.'
    if (!window.confirm(confirmText)) return
    setBusy(action)
    setResult(null)
    try {
      const res = await fetch(`/api/admin/burns/${burnId}/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          notes:
            action === 'force_revert'
              ? '1 Aug rail outage — PSPs confirmed zero dispatches; minting back'
              : '1 Aug rail outage — paying the intended withdrawal via the restored rail',
        }),
      })
      const json = (await res.json()) as ReconcileResult
      setResult(json)
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'request failed' })
    } finally {
      setBusy(null)
    }
  }

  if (result) {
    const good = result.ok === true
    return (
      <div className={`max-w-[220px] rounded-lg border p-2 text-xs ${good ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>
        <p className="font-semibold">{good ? (result.action === 'redispatched' ? `Paid via ${result.rail}` : 'Minted back') : 'Failed'}</p>
        {result.remintTxHash && <p className="mt-0.5 truncate font-mono" title={result.remintTxHash}>{result.remintTxHash.slice(0, 14)}…</p>}
        {result.payoutReference && <p className="mt-0.5 truncate" title={result.payoutReference}>ref {result.payoutReference.slice(0, 12)}… {result.settled ? `(${result.settled})` : ''}</p>}
        {!good && <p className="mt-0.5 break-words">{result.failureReason ?? result.error ?? result.message}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => run('redispatch')}
        disabled={busy !== null}
        className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === 'redispatch' ? 'Paying…' : 'Re-dispatch'}
      </button>
      <button
        type="button"
        onClick={() => run('force_revert')}
        disabled={busy !== null}
        className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === 'force_revert' ? 'Minting back…' : 'Mint back'}
      </button>
    </div>
  )
}
