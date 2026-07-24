'use client'

import { useState } from 'react'

type Kind = 'bill' | 'lipa'

interface SpendResult {
  kind?: string
  amountTzs?: number
  dispatch?: { success: boolean; reference?: string; error?: string; errorCode?: string }
  query?: { status: string; failureReason?: string } | null
  error?: string
}

const QUERY_BADGE: Record<string, string> = {
  completed: 'bg-emerald-500/20 text-emerald-400',
  pending: 'bg-amber-500/20 text-amber-400',
  failed: 'bg-red-500/20 text-red-400',
  reversed: 'bg-red-500/20 text-red-400',
  unknown: 'bg-zinc-500/20 text-zinc-300',
}

/**
 * Client form for POST /api/admin/selcom-spend-test. Deliberately calls the
 * API route (not a server action) so the button exercises the exact same
 * path an engineer's curl would — one code path for the money movement.
 */
export default function SpendTestForm({ billEnabled, lipaEnabled }: { billEnabled: boolean; lipaEnabled: boolean }) {
  const anyEnabled = billEnabled || lipaEnabled
  const [kind, setKind] = useState<Kind>(billEnabled || !lipaEnabled ? 'bill' : 'lipa')
  const [amount, setAmount] = useState('1000')
  const [utilityCode, setUtilityCode] = useState('ATOP')
  const [utilityRef, setUtilityRef] = useState('')
  const [payNumber, setPayNumber] = useState('')
  const [network, setNetwork] = useState('')
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SpendResult | null>(null)
  const [httpError, setHttpError] = useState<string | null>(null)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupOk, setLookupOk] = useState(false)
  const [lookupText, setLookupText] = useState<string | null>(null)

  // Merchant-name check for the Lipa till — read-only, works independently of
  // the payment flags (the lookup endpoint is already permitted for our creds).
  const checkName = async () => {
    setLookupBusy(true)
    setLookupText(null)
    try {
      const res = await fetch(`/api/admin/selcom-lookup-probe?account=${encodeURIComponent(payNumber.trim())}`)
      const json = (await res.json()) as {
        error?: string
        attempts?: Array<{ bank: string; name: string | null; operator?: string; reason?: string }>
      }
      if (!res.ok) {
        setLookupOk(false)
        setLookupText(json.error ?? `HTTP ${res.status}`)
      } else {
        const hit = (json.attempts ?? []).find((a) => a.name)
        if (hit) {
          setLookupOk(true)
          setLookupText(`${hit.name}${hit.operator ? ` · ${hit.operator}` : ''}`)
        } else {
          setLookupOk(false)
          setLookupText(`No name resolved — ${json.attempts?.[0]?.reason ?? 'no attempts'}`)
        }
      }
    } catch (e) {
      setLookupOk(false)
      setLookupText(e instanceof Error ? e.message : 'lookup failed')
    } finally {
      setLookupBusy(false)
    }
  }

  const kindEnabled = kind === 'bill' ? billEnabled : lipaEnabled
  const fieldsOk =
    Number(amount) > 0 &&
    Number(amount) <= 5000 &&
    (kind === 'bill' ? utilityCode.trim() && utilityRef.trim() : payNumber.trim())

  const send = async () => {
    setBusy(true)
    setResult(null)
    setHttpError(null)
    try {
      const body =
        kind === 'bill'
          ? { kind, amountTzs: Number(amount), utilityCode: utilityCode.trim(), utilityRef: utilityRef.trim() }
          : {
              kind,
              amountTzs: Number(amount),
              payNumber: payNumber.trim(),
              ...(network.trim() ? { network: network.trim() } : {}),
            }
      const res = await fetch('/api/admin/selcom-spend-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as SpendResult
      if (!res.ok) {
        setHttpError(json.error ?? `HTTP ${res.status}`)
      } else {
        setResult(json)
      }
    } catch (e) {
      setHttpError(e instanceof Error ? e.message : 'request failed')
    } finally {
      setBusy(false)
      setArmed(false) // re-arm per send — no accidental double-fires
    }
  }

  const tab = (k: Kind, label: string, enabled: boolean) => (
    <button
      type="button"
      onClick={() => enabled && setKind(k)}
      disabled={!enabled}
      className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
        kind === k
          ? 'bg-white/10 text-white'
          : enabled
            ? 'text-zinc-400 hover:bg-white/5 hover:text-white'
            : 'cursor-not-allowed text-zinc-600'
      }`}
    >
      {label}
      {!enabled && <span className="ml-2 text-xs text-zinc-600">flag off</span>}
    </button>
  )

  const inputCls =
    'w-full rounded-xl border border-white/10 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none'

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
      <div className="mb-5 flex gap-2">
        {tab('bill', 'Airtime / Bill', billEnabled)}
        {tab('lipa', 'Lipa Namba', lipaEnabled)}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {kind === 'bill' ? (
          <>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Utility code <span className="text-zinc-600">(ATOP = airtime; catalogue pending from Selcom)</span>
              </label>
              <input value={utilityCode} onChange={(e) => setUtilityCode(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Reference <span className="text-zinc-600">(for airtime: the phone number, e.g. 0744…)</span>
              </label>
              <input
                value={utilityRef}
                onChange={(e) => setUtilityRef(e.target.value)}
                placeholder="07XXXXXXXX"
                className={inputCls}
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">Lipa Namba (pay number)</label>
              <div className="flex gap-2">
                <input
                  value={payNumber}
                  onChange={(e) => {
                    setPayNumber(e.target.value)
                    setLookupText(null)
                  }}
                  placeholder="e.g. 123456"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={checkName}
                  disabled={!payNumber.trim() || lookupBusy}
                  className="shrink-0 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600"
                >
                  {lookupBusy ? 'Checking…' : 'Check name'}
                </button>
              </div>
              {lookupText && (
                <p className={`mt-1.5 text-xs ${lookupOk ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {lookupOk ? `Till registered to: ${lookupText}` : lookupText}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Network <span className="text-zinc-600">(optional — leave blank unless Selcom says otherwise)</span>
              </label>
              <input
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                placeholder="leave blank"
                className={inputCls}
              />
            </div>
          </>
        )}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">Amount (TZS, max 5,000)</label>
          <input
            type="number"
            min={1}
            max={5000}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={armed}
            onChange={(e) => setArmed(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-black accent-emerald-500"
          />
          I understand this sends real money from the custodial account
        </label>
        <button
          type="button"
          onClick={send}
          disabled={!anyEnabled || !kindEnabled || !fieldsOk || !armed || busy}
          className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {busy ? 'Sending…' : 'Send test payment'}
        </button>
      </div>

      {!anyEnabled && (
        <p className="mt-4 text-sm text-amber-400">
          Both rails are currently off — the form is a preview. Add the flag(s) in Vercel and redeploy to arm it.
        </p>
      )}

      {httpError && (
        <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {httpError}
        </div>
      )}

      {result && (
        <div className="mt-5 space-y-3">
          <div
            className={`rounded-xl border p-4 text-sm ${
              result.dispatch?.success
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
          >
            <p className="font-semibold">
              {result.dispatch?.success ? 'Selcom accepted the dispatch' : 'Selcom rejected the dispatch'}
            </p>
            {result.dispatch?.error && <p className="mt-1">{result.dispatch.error}</p>}
            {result.dispatch?.errorCode && <p className="mt-1 text-xs opacity-70">code {result.dispatch.errorCode}</p>}
            {result.dispatch?.reference && (
              <p className="mt-1 text-xs opacity-70">reference {result.dispatch.reference}</p>
            )}
          </div>
          {result.query && (
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black p-4 text-sm">
              <span className="text-zinc-400">Settled status (authoritative query):</span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${QUERY_BADGE[result.query.status] ?? QUERY_BADGE.unknown}`}
              >
                {result.query.status}
              </span>
              {result.query.failureReason && <span className="text-zinc-500">{result.query.failureReason}</span>}
            </div>
          )}
          <details className="rounded-xl border border-white/10 bg-black p-4 text-xs text-zinc-500">
            <summary className="cursor-pointer text-zinc-400">Raw response</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  )
}
