'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPayLinkDeposit } from './actions'

const quickAmounts = [1000, 5000, 10000, 50000]

type PayerStatus = 'pending' | 'processing' | 'success' | 'failed'

export function PayForm({ alias, displayName }: { alias: string; displayName: string }) {
  const [amount, setAmount] = useState('')
  const [phone, setPhone] = useState('')
  const [payerName, setPayerName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [depositId, setDepositId] = useState<string | null>(null)
  const [payStatus, setPayStatus] = useState<PayerStatus | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // Poll deposit status every 3 seconds after submission
  useEffect(() => {
    if (!depositId) return

    setPayStatus('pending')

    async function checkStatus() {
      try {
        const res = await fetch(`/api/pay/status?id=${depositId}`)
        if (!res.ok) return
        const data = await res.json()
        setPayStatus(data.status)

        if (data.status === 'success' || data.status === 'failed') {
          stopPolling()
        }
      } catch {
        // Silently retry on network errors
      }
    }

    // Check immediately, then poll
    checkStatus()
    pollRef.current = setInterval(checkStatus, 3000)

    // Stop polling after 5 minutes (safety timeout)
    const timeout = setTimeout(() => stopPolling(), 5 * 60 * 1000)

    return () => {
      stopPolling()
      clearTimeout(timeout)
    }
  }, [depositId, stopPolling])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!amount || Number(amount) <= 0) {
      setError('Enter a valid amount')
      return
    }
    if (!phone) {
      setError('Enter your phone number')
      return
    }

    setLoading(true)
    const fd = new FormData()
    fd.set('amount', amount)
    fd.set('phone', phone)
    fd.set('payerName', payerName)

    const result = await createPayLinkDeposit(alias, fd)
    setLoading(false)

    if (result.success) {
      setDepositId(result.depositId)
    } else {
      setError(result.error)
    }
  }

  // ── After submission: live status tracking ──
  if (depositId && payStatus) {
    return (
      <div className="py-8 text-center">
        {payStatus === 'success' ? (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
              <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-white">Payment successful</h2>
            <p className="mt-2 text-sm text-zinc-400">
              <span className="font-semibold text-white">{Number(amount).toLocaleString()} TZS</span>{' '}
              sent to @{displayName}
            </p>
          </>
        ) : payStatus === 'failed' ? (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/20">
              <svg className="h-8 w-8 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-white">Payment failed</h2>
            <p className="mt-2 text-sm text-zinc-400">
              The payment was not completed. Please try again.
            </p>
            <button
              type="button"
              onClick={() => {
                setDepositId(null)
                setPayStatus(null)
              }}
              className="mt-4 rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            {/* Pending / Processing — animated pulse */}
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/20">
              <svg className="h-8 w-8 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-white">
              {payStatus === 'pending' ? 'Waiting for approval' : 'Processing payment'}
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              {payStatus === 'pending'
                ? 'Check your phone to approve the payment'
                : 'Payment received — minting tokens...'}
            </p>
            <p className="mt-4 text-xs text-zinc-600">
              <span className="font-semibold text-white">{Number(amount).toLocaleString()} TZS</span>{' '}
              to @{displayName}
            </p>
          </>
        )}
      </div>
    )
  }

  // ── Payment form ──
  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Amount */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">Amount (TZS)</label>
        <input
          type="number"
          inputMode="numeric"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-3xl font-bold text-white placeholder:text-zinc-700 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        />
        <div className="mt-2 flex gap-2">
          {quickAmounts.map((qa) => (
            <button
              key={qa}
              type="button"
              onClick={() => setAmount(String(qa))}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10"
            >
              {qa >= 1000 ? `${qa / 1000}k` : qa}
            </button>
          ))}
        </div>
      </div>

      {/* Phone */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">Your phone number</label>
        <input
          type="tel"
          inputMode="tel"
          placeholder="07XX XXX XXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-base text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        />
      </div>

      {/* Payer name (optional) */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">Your name (optional)</label>
        <input
          type="text"
          placeholder="Jane"
          value={payerName}
          onChange={(e) => setPayerName(e.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-base text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        />
      </div>

      {error && (
        <p className="rounded-xl bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 active:scale-[0.97] disabled:opacity-70 disabled:cursor-not-allowed hover:shadow-blue-500/40"
      >
        {loading ? 'Sending...' : `Pay @${displayName}`}
      </button>
    </form>
  )
}
