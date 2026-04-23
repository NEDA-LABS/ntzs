'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

import { IconCard, IconPhone } from '@/app/app/_components/icons'

import { createDepositRequestAction, createCardDepositRequestAction } from './actions'

type PaymentMethod = 'mobile' | 'card'

const quickAmounts = [1000, 5000, 10000, 50000]

interface DepositFormProps {
  defaultBankId?: string
  userPhone?: string | null
}

export function DepositForm({ defaultBankId, userPhone }: DepositFormProps) {
  const [amount, setAmount] = useState('')
  const [phone, setPhone] = useState(userPhone || '')
  const [rememberPhone, setRememberPhone] = useState(true)
  const [isSavedNumber, setIsSavedNumber] = useState(false)
  const [method, setMethod] = useState<PaymentMethod>('mobile')
  const [payWithOpen, setPayWithOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submittedAmount, setSubmittedAmount] = useState('')
  const [depositId, setDepositId] = useState<string | null>(null)
  const [payStatus, setPayStatus] = useState<'pending' | 'processing' | 'success' | 'failed' | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('ntzs_saved_phone')
      if (saved && !userPhone) {
        setPhone(saved)
        setIsSavedNumber(true)
      }
    } catch {}
  }, [userPhone])

  useEffect(() => {
    if (!depositId) return
    setPayStatus('pending')

    async function checkStatus() {
      try {
        const res = await fetch(`/api/pay/status?id=${depositId}`)
        if (!res.ok) return
        const data = await res.json()
        setPayStatus(data.status)
        if (data.status === 'success' || data.status === 'failed') stopPolling()
      } catch {}
    }

    checkStatus()
    pollRef.current = setInterval(checkStatus, 3000)
    const timeout = setTimeout(() => stopPolling(), 5 * 60 * 1000)
    return () => { stopPolling(); clearTimeout(timeout) }
  }, [depositId, stopPolling])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!amount || Number(amount) <= 0) { setError('Enter a valid amount'); return }
    setLoading(true)
    if (method === 'mobile') {
      if (!phone) { setError('Enter your phone number'); setLoading(false); return }
      try {
        try {
          if (rememberPhone && phone) localStorage.setItem('ntzs_saved_phone', phone)
          else if (!rememberPhone) localStorage.removeItem('ntzs_saved_phone')
          const amt = Number(amount)
          if (amt > 0) sessionStorage.setItem('deposit_success', JSON.stringify({ amount: amt }))
        } catch {}
        const fd = new FormData()
        fd.set('bankId', defaultBankId ?? '')
        fd.set('paymentMethod', 'mpesa')
        fd.set('amountTzs', amount)
        fd.set('buyerPhone', phone)
        setSubmittedAmount(amount)
        const result = await createDepositRequestAction(fd)
        setDepositId(result.depositId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Payment failed. Please try again.')
      }
      setLoading(false)
    } else {
      try {
        try {
          const amt = Number(amount)
          if (amt > 0) sessionStorage.setItem('deposit_success', JSON.stringify({ amount: amt, method: 'card' }))
        } catch {}
        const fd = new FormData()
        fd.set('bankId', defaultBankId ?? '')
        fd.set('amountTzs', amount)
        const result = await createCardDepositRequestAction(fd)
        window.location.href = result.paymentUrl
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
        setLoading(false)
      }
    }
  }

  if (depositId && payStatus) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border/40 bg-background/35 backdrop-blur-xl">
        <div className="px-6 py-10 text-center">

          {payStatus === 'success' ? (
            <>
              <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" style={{ animationDuration: '1.4s', animationIterationCount: 1 }} />
                <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/30">
                  <svg className="h-9 w-9 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <h2 className="mt-5 text-xl font-bold text-foreground">Deposit confirmed</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Your nTZS is on its way to your wallet</p>
              <div className="mx-auto mt-5 w-fit rounded-2xl bg-emerald-500/10 px-6 py-3 ring-1 ring-emerald-500/20">
                <p className="text-2xl font-bold tabular-nums text-emerald-400">{Number(submittedAmount).toLocaleString()} TZS</p>
                <p className="mt-0.5 text-xs text-emerald-400/60">minted as nTZS</p>
              </div>
              <div className="mt-7 flex flex-col gap-3">
                <Link
                  href="/app/user"
                  className="w-full rounded-2xl bg-primary px-6 py-4 text-center text-base font-semibold text-primary-foreground transition-opacity duration-75 active:scale-[0.98] hover:opacity-90"
                >
                  Go to Dashboard
                </Link>
                <button
                  type="button"
                  onClick={() => { setDepositId(null); setPayStatus(null); setAmount('') }}
                  className="w-full rounded-2xl border border-border/40 bg-background/35 px-6 py-4 text-base font-medium text-foreground backdrop-blur-xl transition-all duration-75 active:scale-[0.98] hover:bg-background/45"
                >
                  Make another deposit
                </button>
              </div>
            </>
          ) : payStatus === 'failed' ? (
            <>
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-rose-500/20 ring-1 ring-rose-500/30">
                <svg className="h-9 w-9 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-bold text-foreground">Payment not completed</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">The payment was cancelled or timed out. Please try again.</p>
              <div className="mt-7 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => { setDepositId(null); setPayStatus(null) }}
                  className="w-full rounded-2xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground transition-opacity duration-75 active:scale-[0.98] hover:opacity-90"
                >
                  Try again
                </button>
                <Link
                  href="/app/user"
                  className="w-full rounded-2xl border border-border/40 bg-background/35 px-6 py-4 text-center text-base font-medium text-foreground backdrop-blur-xl transition-all duration-75 active:scale-[0.98] hover:bg-background/45"
                >
                  Go to Dashboard
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-blue-600/15 ring-1 ring-blue-600/20">
                <svg className="h-9 w-9 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-bold text-foreground">
                {payStatus === 'pending' ? 'Waiting for approval' : 'Processing payment'}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {payStatus === 'pending'
                  ? 'Check your phone — the M-Pesa prompt has been sent'
                  : 'Payment received, minting your nTZS...'}
              </p>
              <div className="mx-auto mt-5 w-fit rounded-2xl bg-blue-600/10 px-6 py-3 ring-1 ring-blue-600/20">
                <p className="text-2xl font-bold tabular-nums text-foreground">{Number(submittedAmount).toLocaleString()} TZS</p>
                <p className="mt-0.5 text-xs text-blue-400/70">in progress</p>
              </div>
              <div className="mt-6 flex items-center justify-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: '0ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: '300ms' }} />
              </div>
              <p className="mt-4 text-xs text-muted-foreground">This page updates automatically</p>
            </>
          )}

        </div>
      </div>
    )
  }

  if (!defaultBankId) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">System not configured yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">Please contact support.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Amount */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Amount (TZS)</label>
        <input
          type="number"
          inputMode="numeric"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-2xl border border-border/40 bg-background/35 px-4 py-4 text-3xl font-bold text-foreground placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring backdrop-blur-xl"
        />
        <div className="mt-2 flex gap-2">
          {quickAmounts.map((qa) => (
            <button
              key={qa}
              type="button"
              onClick={() => setAmount(String(qa))}
              className="rounded-xl border border-border/40 bg-background/35 px-3 py-1.5 text-xs font-medium text-foreground/80 backdrop-blur-xl transition-colors hover:bg-background/45 hover:text-foreground"
            >
              {qa >= 1000 ? `${qa / 1000}k` : qa}
            </button>
          ))}
        </div>
      </div>

      {/* Phone — mobile only */}
      {method === 'mobile' && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Your phone number</label>
            {isSavedNumber && (
              <span className="flex items-center gap-1 rounded-full bg-blue-600/15 px-2 py-0.5 text-[10px] font-semibold text-blue-400 ring-1 ring-blue-600/20">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </span>
            )}
          </div>
          <input
            type="tel"
            inputMode="tel"
            placeholder="07XX XXX XXX"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setIsSavedNumber(false) }}
            className="w-full rounded-2xl border border-border/40 bg-background/35 px-4 py-3.5 text-base text-foreground placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring backdrop-blur-xl"
          />
          <label className="mt-2.5 flex cursor-pointer items-center gap-2.5">
            <div
              onClick={() => setRememberPhone((p) => !p)}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${rememberPhone ? 'bg-blue-600' : 'bg-white/10'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${rememberPhone ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-xs text-muted-foreground">Remember for next time</span>
          </label>
        </div>
      )}

      {/* Pay with — collapsible */}
      <div className="overflow-hidden rounded-2xl border border-border/40 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setPayWithOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pay with</span>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              {method === 'mobile'
                ? <><IconPhone className="h-4 w-4 text-blue-400" />Mobile Money</>
                : <><IconCard className="h-4 w-4 text-blue-400" />Card</>
              }
            </span>
            <svg
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${payWithOpen ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
        {payWithOpen && (
          <div className="space-y-1 border-t border-border/40 p-2">
            <button
              type="button"
              onClick={() => { setMethod('mobile'); setPayWithOpen(false) }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${method === 'mobile' ? 'bg-blue-600/10 text-foreground' : 'text-foreground/70 hover:bg-background/35'}`}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${method === 'mobile' ? 'bg-blue-600/20' : 'bg-background/35'}`}>
                <IconPhone className={`h-4 w-4 ${method === 'mobile' ? 'text-blue-300' : 'text-foreground/50'}`} />
              </span>
              <span>
                <span className="block text-sm font-semibold">Mobile Money</span>
                <span className={`block text-xs ${method === 'mobile' ? 'text-blue-300/70' : 'text-muted-foreground'}`}>Snippe</span>
              </span>
              {method === 'mobile' && (
                <svg className="ml-auto h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => { setMethod('card'); setPayWithOpen(false) }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${method === 'card' ? 'bg-blue-600/10 text-foreground' : 'text-foreground/70 hover:bg-background/35'}`}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${method === 'card' ? 'bg-blue-600/20' : 'bg-background/35'}`}>
                <IconCard className={`h-4 w-4 ${method === 'card' ? 'text-blue-300' : 'text-foreground/50'}`} />
              </span>
              <span>
                <span className="block text-sm font-semibold">Card</span>
                <span className={`block text-xs ${method === 'card' ? 'text-blue-300/70' : 'text-muted-foreground'}`}>Visa / Mastercard</span>
              </span>
              {method === 'card' && (
                <svg className="ml-auto h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-xl bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-2xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground transition-opacity duration-75 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100 hover:opacity-90"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {method === 'card' ? 'Redirecting...' : 'Processing...'}
          </span>
        ) : amount && Number(amount) > 0 ? (
          `Deposit ${Number(amount).toLocaleString()} TZS`
        ) : (
          'Deposit'
        )}
      </button>
    </form>
  )
}
