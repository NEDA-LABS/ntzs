'use client'

import { useState } from 'react'

import {
  SELCOM_BILLERS,
  BILLER_CATEGORY_LABELS,
  getBiller,
  validateUtilityRef,
  lengthHint,
  type BillerCategory,
} from '@/lib/psp/selcom-billers'
import QrScanPanel from './QrScanPanel'

type Kind = 'bill' | 'lipa' | 'wallet' | 'bank' | 'scan'
const CUSTOM_CODE = '__custom'

export interface BankOption {
  code: string
  name: string
  reference: 'numeric' | 'alphanumeric'
}

interface SpendResult {
  kind?: string
  amountTzs?: number
  dispatch?: { success: boolean; reference?: string; error?: string; errorCode?: string }
  query?: { status: string; failureReason?: string } | null
  lookup?: { name: string | null; reason?: string }
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
export default function SpendTestForm({
  billEnabled,
  lipaEnabled,
  walletEnabled,
  bankEnabled,
  bankOptions,
}: {
  billEnabled: boolean
  lipaEnabled: boolean
  walletEnabled: boolean
  bankEnabled: boolean
  bankOptions: BankOption[]
}) {
  const anyEnabled = billEnabled || lipaEnabled || walletEnabled || bankEnabled
  const [kind, setKind] = useState<Kind>(billEnabled || !lipaEnabled ? 'bill' : 'lipa')
  const [phone, setPhone] = useState('')
  const [fiCode, setFiCode] = useState('')
  const [bankCode, setBankCode] = useState('CRDB')
  const [accountNumber, setAccountNumber] = useState('')
  const [bankLookupBusy, setBankLookupBusy] = useState(false)
  const [bankLookupOk, setBankLookupOk] = useState(false)
  const [bankLookupText, setBankLookupText] = useState<string | null>(null)
  const [amount, setAmount] = useState('1000')
  const [utilityCode, setUtilityCode] = useState('TOP')
  const [customCode, setCustomCode] = useState('')
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
  const [billLookupBusy, setBillLookupBusy] = useState(false)
  const [billLookupOk, setBillLookupOk] = useState(false)
  const [billLookupText, setBillLookupText] = useState<string | null>(null)
  const [recheckRef, setRecheckRef] = useState('')
  const [recheckBusy, setRecheckBusy] = useState(false)
  const [recheckResult, setRecheckResult] = useState<{
    reference?: string
    query?: { status: string; failureReason?: string }
    raw?: unknown
    error?: string
  } | null>(null)

  // Bill-account validation via neda-lookup: bank=<utilityCode> resolves the
  // registered owner (e.g. a LUKU meter's customer) before any money moves.
  const checkBillName = async () => {
    setBillLookupBusy(true)
    setBillLookupText(null)
    try {
      const res = await fetch(
        `/api/admin/selcom-lookup-probe?account=${encodeURIComponent(utilityRef.trim())}&bank=${encodeURIComponent(effectiveCode)}`
      )
      const json = (await res.json()) as {
        error?: string
        attempts?: Array<{ endpoint: string; bank: string; name: string | null; operator?: string; reason?: string }>
      }
      if (!res.ok) {
        setBillLookupOk(false)
        setBillLookupText(json.error ?? `HTTP ${res.status}`)
      } else {
        const hit = (json.attempts ?? []).find((a) => a.name)
        if (hit) {
          setBillLookupOk(true)
          const operator = hit.operator && hit.operator.trim() !== '-' ? ` · ${hit.operator}` : ''
          setBillLookupText(`${hit.name}${operator}`)
        } else {
          setBillLookupOk(false)
          setBillLookupText(`No name resolved — ${json.attempts?.[0]?.reason ?? 'no attempts'}`)
        }
      }
    } catch (e) {
      setBillLookupOk(false)
      setBillLookupText(e instanceof Error ? e.message : 'lookup failed')
    } finally {
      setBillLookupBusy(false)
    }
  }

  // Re-ask Selcom for a previous dispatch's settled status ("pending" at
  // send time is just the instant-after answer — settlement comes later).
  const recheck = async () => {
    setRecheckBusy(true)
    setRecheckResult(null)
    try {
      const res = await fetch(`/api/admin/selcom-spend-test?reference=${encodeURIComponent(recheckRef.trim())}`)
      const json = await res.json()
      setRecheckResult(res.ok ? json : { error: json.error ?? `HTTP ${res.status}` })
    } catch (e) {
      setRecheckResult({ error: e instanceof Error ? e.message : 'request failed' })
    } finally {
      setRecheckBusy(false)
    }
  }

  // Registered-name check for a bank account — same read-only lookup probe the
  // bill and lipa tabs use, with the bank FI code as the lookup "bank".
  const checkBankName = async () => {
    setBankLookupBusy(true)
    setBankLookupText(null)
    try {
      const res = await fetch(
        `/api/admin/selcom-lookup-probe?account=${encodeURIComponent(accountNumber.trim())}&bank=${encodeURIComponent(bankCode)}`
      )
      const json = (await res.json()) as {
        error?: string
        attempts?: Array<{ bank: string; name: string | null; operator?: string; reason?: string }>
      }
      if (!res.ok) {
        setBankLookupOk(false)
        setBankLookupText(json.error ?? `HTTP ${res.status}`)
      } else {
        const hit = (json.attempts ?? []).find((a) => a.name)
        if (hit) {
          setBankLookupOk(true)
          setBankLookupText(hit.name!)
        } else {
          setBankLookupOk(false)
          setBankLookupText(`No name resolved — ${json.attempts?.[0]?.reason ?? 'no attempts'}`)
        }
      }
    } catch (e) {
      setBankLookupOk(false)
      setBankLookupText(e instanceof Error ? e.message : 'lookup failed')
    } finally {
      setBankLookupBusy(false)
    }
  }

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
          // Selcom returns '-' for operator on merchant tills — treat as absent.
          const operator = hit.operator && hit.operator.trim() !== '-' ? ` · ${hit.operator}` : ''
          setLookupText(`${hit.name}${operator}`)
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

  const kindEnabled =
    kind === 'bill' ? billEnabled : kind === 'lipa' ? lipaEnabled : kind === 'bank' ? bankEnabled : walletEnabled
  const effectiveCode = utilityCode === CUSTOM_CODE ? customCode.trim().toUpperCase() : utilityCode
  const selectedBiller = getBiller(effectiveCode)
  const refCheck = validateUtilityRef(effectiveCode, utilityRef)
  const selectedBank = bankOptions.find((b) => b.code === bankCode)
  const accountPatternOk = selectedBank?.reference === 'alphanumeric'
    ? /^[A-Za-z0-9]{5,24}$/.test(accountNumber.trim())
    : /^\d{5,20}$/.test(accountNumber.trim())
  const fieldsOk =
    Number(amount) > 0 &&
    Number(amount) <= 5000 &&
    (kind === 'bill'
      ? Boolean(effectiveCode && utilityRef.trim() && refCheck.ok)
      : kind === 'lipa'
        ? Boolean(payNumber.trim())
        : kind === 'bank'
          ? Boolean(bankCode && accountPatternOk)
          : phone.trim().replace(/\D/g, '').length >= 9)

  const send = async () => {
    setBusy(true)
    setResult(null)
    setHttpError(null)
    try {
      const body =
        kind === 'bill'
          ? { kind, amountTzs: Number(amount), utilityCode: effectiveCode, utilityRef: utilityRef.trim() }
          : kind === 'lipa'
            ? {
                kind,
                amountTzs: Number(amount),
                payNumber: payNumber.trim(),
                ...(network.trim() ? { network: network.trim() } : {}),
              }
            : kind === 'bank'
              ? { kind, amountTzs: Number(amount), bankCode, accountNumber: accountNumber.trim() }
              : {
                  kind,
                  amountTzs: Number(amount),
                  phone: phone.trim(),
                  ...(fiCode.trim() ? { fiCode: fiCode.trim().toUpperCase() } : {}),
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
        {tab('wallet', 'Wallet payout', walletEnabled)}
        {tab('bank', 'Bank payout', bankEnabled)}
        {/* Read-only: decoding a QR moves no money, so it is never flag-gated. */}
        {tab('scan', 'Scan to pay', true)}
      </div>

      {kind === 'scan' && (
        <QrScanPanel
          onUseTill={(till, amountTzs) => {
            setPayNumber(till)
            if (amountTzs) setAmount(String(amountTzs))
            setLookupText(null)
            setKind('lipa')
          }}
        />
      )}

      {kind !== 'scan' && (
      <>
      <div className="grid gap-4 sm:grid-cols-2">
        {kind === 'bank' ? (
          <>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Bank <span className="text-zinc-600">(canonical FI codes — every code is unproven until one live probe settles)</span>
              </label>
              <select
                value={bankCode}
                onChange={(e) => {
                  setBankCode(e.target.value)
                  setBankLookupText(null)
                }}
                className={inputCls}
              >
                {bankOptions.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Account number{' '}
                <span className="text-zinc-600">
                  ({selectedBank?.reference === 'alphanumeric' ? 'alphanumeric — CRDB formats differ' : 'digits only'})
                </span>
              </label>
              <div className="flex gap-2">
                <input
                  value={accountNumber}
                  onChange={(e) => {
                    setAccountNumber(e.target.value)
                    setBankLookupText(null)
                  }}
                  placeholder={selectedBank?.reference === 'alphanumeric' ? 'e.g. 0150XXXXXX00' : 'account number'}
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={checkBankName}
                  disabled={!accountNumber.trim() || bankLookupBusy}
                  className="shrink-0 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600"
                >
                  {bankLookupBusy ? 'Checking…' : 'Check name'}
                </button>
              </div>
              {bankLookupText && (
                <p className={`mt-1.5 text-xs ${bankLookupOk ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {bankLookupOk ? `Account registered to: ${bankLookupText}` : bankLookupText}
                </p>
              )}
            </div>
          </>
        ) : kind === 'wallet' ? (
          <>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Phone (mobile wallet to pay)
              </label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 0744277496"
                className={inputCls}
              />
              <p className="mt-1.5 text-xs text-zinc-500">
                The exact call the withdrawal rail makes — the result shows Selcom&apos;s raw verdict.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                FI code override <span className="text-zinc-600">(optional — blank uses the proven mapping; use this to prove a new network&apos;s code)</span>
              </label>
              <input
                value={fiCode}
                onChange={(e) => setFiCode(e.target.value)}
                placeholder="e.g. TIGOPESA (candidate to prove)"
                className={inputCls}
              />
            </div>
          </>
        ) : kind === 'bill' ? (
          <>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Biller <span className="text-zinc-600">(catalogue: SB Biller Codes, 25 Jul)</span>
              </label>
              <select value={utilityCode} onChange={(e) => setUtilityCode(e.target.value)} className={inputCls}>
                {(Object.keys(BILLER_CATEGORY_LABELS) as BillerCategory[]).map((cat) => (
                  <optgroup key={cat} label={BILLER_CATEGORY_LABELS[cat]}>
                    {SELCOM_BILLERS.filter((x) => x.category === cat).map((x) => (
                      <option key={x.code} value={x.code}>
                        {x.code} — {x.refLabel}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={CUSTOM_CODE}>Other (type a code)…</option>
              </select>
              {utilityCode === CUSTOM_CODE && (
                <input
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  placeholder="utility code, e.g. ATOP"
                  className={`${inputCls} mt-2`}
                />
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                {selectedBiller ? selectedBiller.refLabel : 'Reference'}{' '}
                {selectedBiller && <span className="text-zinc-600">({lengthHint(selectedBiller)})</span>}
              </label>
              <div className="flex gap-2">
                <input
                  value={utilityRef}
                  onChange={(e) => {
                    setUtilityRef(e.target.value)
                    setBillLookupText(null)
                  }}
                  placeholder={selectedBiller?.refLabel ?? 'reference at the biller'}
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={checkBillName}
                  disabled={!utilityRef.trim() || !effectiveCode || billLookupBusy}
                  className="shrink-0 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600"
                >
                  {billLookupBusy ? 'Checking…' : 'Check name'}
                </button>
              </div>
              {utilityRef.trim() && !refCheck.ok && (
                <p className="mt-1.5 text-xs text-amber-400">{refCheck.reason}</p>
              )}
              {billLookupText && (
                <p className={`mt-1.5 text-xs ${billLookupOk ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {billLookupOk ? `Registered to: ${billLookupText}` : billLookupText}
                </p>
              )}
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
      </>
      )}

      <div className="mt-8 border-t border-white/10 pt-6">
        <p className="mb-3 text-sm font-medium text-zinc-300">
          Re-check a previous reference{' '}
          <span className="text-xs font-normal text-zinc-500">
            (&quot;pending&quot; at send time is the instant-after answer — settlement lands later)
          </span>
        </p>
        <div className="flex gap-2">
          <input
            value={recheckRef}
            onChange={(e) => setRecheckRef(e.target.value)}
            placeholder="e.g. 202607250630"
            className={inputCls}
          />
          <button
            type="button"
            onClick={recheck}
            disabled={!recheckRef.trim() || recheckBusy}
            className="shrink-0 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600"
          >
            {recheckBusy ? 'Checking…' : 'Check status'}
          </button>
        </div>
        {recheckResult?.error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {recheckResult.error}
          </div>
        )}
        {recheckResult?.query && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black p-4 text-sm">
              <span className="text-zinc-400">{recheckResult.reference}:</span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${QUERY_BADGE[recheckResult.query.status] ?? QUERY_BADGE.unknown}`}
              >
                {recheckResult.query.status}
              </span>
              {recheckResult.query.failureReason && (
                <span className="text-zinc-500">{recheckResult.query.failureReason}</span>
              )}
            </div>
            <details className="rounded-xl border border-white/10 bg-black p-4 text-xs text-zinc-500">
              <summary className="cursor-pointer text-zinc-400">Raw query payload</summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(recheckResult.raw, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}
