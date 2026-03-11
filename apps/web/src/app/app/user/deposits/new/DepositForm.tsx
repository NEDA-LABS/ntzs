'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'

import { IconCard, IconInfo, IconPhone } from '@/app/app/_components/icons'

import { createDepositRequestAction, createCardDepositRequestAction } from './actions'

type PaymentMethod = 'mobile' | 'card'

const ACTIVE_PSP_NAME = 'Mobile Money'
const ACTIVE_PSP_METHOD_LABEL = 'Snippe'

function SubmitButton({ label, disabled }: { label?: string; disabled?: boolean }) {
  const { pending } = useFormStatus()
  const isDisabled = Boolean(disabled) || pending

  return (
    <button
      type="submit"
      disabled={isDisabled}
      className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 active:scale-[0.97] active:shadow-blue-500/15 disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100 hover:shadow-blue-500/40"
    >
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Processing...
        </span>
      ) : (
        label ?? 'Top up wallet'
      )}
    </button>
  )
}

function SuccessIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

interface DepositFormProps {
  defaultBankId?: string
  userPhone?: string | null
}

export function DepositForm({ defaultBankId, userPhone }: DepositFormProps) {
  const [submittedAmount, setSubmittedAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('mobile')
  const [cardLoading, setCardLoading] = useState(false)
  const [cardError, setCardError] = useState('')
  const [mobileError, setMobileError] = useState('')
  const [amount, setAmount] = useState<string>('')
  const [showPhoneModal, setShowPhoneModal] = useState(false)
  const [modalPhone, setModalPhone] = useState(userPhone || '')
  const [rememberPhone, setRememberPhone] = useState(true)
  const [isSavedNumber, setIsSavedNumber] = useState(false)
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
      if (saved) {
        if (!userPhone) setModalPhone(saved)
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

  const quickAdd = (delta: number) => {
    const base = Number(amount || '0')
    const next = Math.max(0, base + delta)
    setAmount(String(next))
  }

  if (depositId && payStatus) {
    return (
      <div className="overflow-hidden rounded-2xl bg-[#12121e] ring-1 ring-white/[0.06]">
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
              <h2 className="mt-5 text-xl font-bold text-white">Deposit confirmed</h2>
              <p className="mt-1.5 text-sm text-zinc-400">Your nTZS is on its way to your wallet</p>
              <div className="mx-auto mt-5 w-fit rounded-2xl bg-emerald-500/10 px-6 py-3 ring-1 ring-emerald-500/20">
                <p className="text-2xl font-bold tabular-nums text-emerald-400">{Number(submittedAmount).toLocaleString()} TZS</p>
                <p className="mt-0.5 text-xs text-emerald-400/60">minted as nTZS</p>
              </div>
              <div className="mt-7 flex flex-col gap-3">
                <Link
                  href="/app/user"
                  className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4 text-center text-base font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 active:scale-[0.98] hover:shadow-blue-500/40"
                >
                  Go to Dashboard
                </Link>
                <button
                  type="button"
                  onClick={() => { setDepositId(null); setPayStatus(null); setAmount('') }}
                  className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-6 py-4 text-base font-medium text-white transition-all duration-75 active:scale-[0.98] hover:bg-white/[0.06]"
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
              <h2 className="mt-5 text-xl font-bold text-white">Payment not completed</h2>
              <p className="mt-1.5 text-sm text-zinc-400">The payment was cancelled or timed out. Please try again.</p>
              <div className="mt-7 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => { setDepositId(null); setPayStatus(null) }}
                  className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 active:scale-[0.98] hover:shadow-blue-500/40"
                >
                  Try again
                </button>
                <Link
                  href="/app/user"
                  className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-6 py-4 text-center text-base font-medium text-white transition-all duration-75 active:scale-[0.98] hover:bg-white/[0.06]"
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
              <h2 className="mt-5 text-xl font-bold text-white">
                {payStatus === 'pending' ? 'Waiting for approval' : 'Processing payment'}
              </h2>
              <p className="mt-1.5 text-sm text-zinc-400">
                {payStatus === 'pending'
                  ? 'Check your phone — the M-Pesa prompt has been sent'
                  : 'Payment received, minting your nTZS...'}
              </p>
              <div className="mx-auto mt-5 w-fit rounded-2xl bg-blue-600/10 px-6 py-3 ring-1 ring-blue-600/20">
                <p className="text-2xl font-bold tabular-nums text-white">{Number(submittedAmount).toLocaleString()} TZS</p>
                <p className="mt-0.5 text-xs text-blue-400/70">in progress</p>
              </div>
              <div className="mt-6 flex items-center justify-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: '0ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: '300ms' }} />
              </div>
              <p className="mt-4 text-xs text-zinc-600">This page updates automatically</p>
            </>
          )}

        </div>
      </div>
    )
  }

  if (!defaultBankId) {
    return (
      <div className="overflow-hidden rounded-2xl bg-[#12121e] p-6 ring-1 ring-white/[0.06]">
        <div className="py-12 text-center">
          <p className="text-sm text-zinc-400">System not configured yet.</p>
          <p className="mt-1 text-xs text-zinc-600">Please contact support.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-[#12121e] p-6 ring-1 ring-white/[0.06]">

      {/* Amount input — shared between methods */}
      <div className="mb-5 rounded-2xl border border-white/[0.06] bg-black/40 p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">TZS</span>
        </div>
        <div className="mt-2">
          <input
            id="shared-amount"
            type="number"
            min={1}
            step={1}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="0"
            inputMode="numeric"
            className="w-full bg-transparent text-5xl font-bold tracking-tight text-white outline-none placeholder:text-zinc-700"
          />
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => quickAdd(10000)} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.08]">+10k</button>
          <button type="button" onClick={() => quickAdd(20000)} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.08]">+20k</button>
          <button type="button" onClick={() => quickAdd(50000)} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.08]">+50k</button>
        </div>
      </div>

      {/* Payment method selector */}
      <div className="mb-5">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Pay with</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Mobile Money */}
          <button
            type="button"
            onClick={() => setMethod('mobile')}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-4 text-left text-sm transition-colors ${
              method === 'mobile'
                ? 'border-blue-500/40 bg-blue-600/10 text-white'
                : 'border-white/[0.06] bg-white/[0.03] text-white/70 hover:bg-white/[0.06]'
            }`}
          >
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${method === 'mobile' ? 'bg-blue-600/20' : 'bg-white/[0.06]'}`}>
              <IconPhone className={`h-5 w-5 ${method === 'mobile' ? 'text-blue-300' : 'text-white/50'}`} />
            </span>
            <span>
              <span className="block font-semibold">{ACTIVE_PSP_NAME}</span>
              <span className={`block text-xs ${method === 'mobile' ? 'text-blue-300/70' : 'text-white/40'}`}>{ACTIVE_PSP_METHOD_LABEL}</span>
            </span>
          </button>

          {/* Card */}
          <button
            type="button"
            onClick={() => setMethod('card')}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-4 text-left text-sm transition-colors ${
              method === 'card'
                ? 'border-blue-500/40 bg-blue-600/10 text-white'
                : 'border-white/[0.06] bg-white/[0.03] text-white/70 hover:bg-white/[0.06]'
            }`}
          >
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${method === 'card' ? 'bg-blue-600/20' : 'bg-white/[0.06]'}`}>
              <IconCard className={`h-5 w-5 ${method === 'card' ? 'text-blue-300' : 'text-white/50'}`} />
            </span>
            <span>
              <span className="block font-semibold">Card</span>
              <span className={`block text-xs ${method === 'card' ? 'text-blue-300/70' : 'text-white/40'}`}>Visa / Mastercard</span>
            </span>
          </button>
        </div>
      </div>

      {/* Mobile money: two-step flow (amount first, then phone in modal) */}
      {method === 'mobile' && (
        <div className="space-y-4">
          {mobileError && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {mobileError}
            </div>
          )}

          <button
            type="button"
            disabled={!amount || Number(amount) <= 0}
            onClick={() => {
              setMobileError('')
              setShowPhoneModal(true)
            }}
            className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 active:scale-[0.97] disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100 hover:shadow-blue-500/40"
          >
            {amount ? `Deposit ${Number(amount).toLocaleString()} TZS` : 'Deposit'}
          </button>

          <div className="flex items-start gap-2 rounded-2xl border border-white/[0.05] bg-white/[0.02] p-4">
            <IconInfo className="mt-0.5 h-4 w-4 text-zinc-500" />
            <p className="text-sm text-zinc-500">
              Next step: confirm and enter the phone number to receive the payment prompt.
            </p>
          </div>
        </div>
      )}

      {/* Card payment form */}
      {method === 'card' && (
        <div className="space-y-4">
          {cardError && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {cardError}
            </div>
          )}

          <button
            type="button"
            disabled={cardLoading || !amount || Number(amount) <= 0}
            onClick={async () => {
              if (!amount || Number(amount) <= 0) {
                setCardError('Please enter an amount above')
                return
              }
              setCardError('')
              setCardLoading(true)
              try {
                // Stash toast message for when user returns from checkout
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
                setCardError(err instanceof Error ? err.message : 'Something went wrong')
                setCardLoading(false)
              }
            }}
            className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 active:scale-[0.97] disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100 hover:shadow-blue-500/40"
          >
            {cardLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Redirecting to checkout...
              </span>
            ) : (
              amount ? `Deposit ${Number(amount).toLocaleString()} TZS` : 'Deposit'
            )}
          </button>

          <div className="flex items-start gap-2 rounded-2xl border border-white/[0.05] bg-white/[0.02] p-4">
            <IconInfo className="mt-0.5 h-4 w-4 text-zinc-500" />
            <p className="text-sm text-zinc-500">
              You'll be redirected to a secure card checkout. Accepted: Visa, Mastercard. Your nTZS will be minted automatically after payment.
            </p>
          </div>
        </div>
      )}

      {/* Phone modal */}
      {showPhoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowPhoneModal(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-[#12121e] p-6 ring-1 ring-white/[0.08]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-white">Confirm deposit</h3>
                <p className="mt-0.5 text-xs text-zinc-500">Mobile Money · {amount ? `${Number(amount).toLocaleString()} TZS` : ''}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPhoneModal(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form
              onSubmit={() => {
                try {
                  const amt = Number(amount)
                  if (amt > 0) sessionStorage.setItem('deposit_success', JSON.stringify({ amount: amt }))
                  if (rememberPhone && modalPhone) {
                    localStorage.setItem('ntzs_saved_phone', modalPhone)
                  } else if (!rememberPhone) {
                    localStorage.removeItem('ntzs_saved_phone')
                  }
                } catch {}
              }}
              action={async (formData: FormData) => {
                try {
                  formData.set('amountTzs', amount)
                  setSubmittedAmount(amount)
                  const result = await createDepositRequestAction(formData)
                  setDepositId(result.depositId)
                  setShowPhoneModal(false)
                } catch (error) {
                  setShowPhoneModal(false)
                  const errorMessage = error instanceof Error ? error.message : 'Payment failed. Please try again.'
                  setMobileError(errorMessage)
                  console.error('Deposit failed:', error)
                }
              }}
              className="space-y-4"
            >
              <input type="hidden" name="bankId" value={defaultBankId} />
              <input type="hidden" name="paymentMethod" value="mpesa" />
              <input type="hidden" name="amountTzs" value={amount} />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-zinc-300">Mobile Money Number</label>
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
                  name="buyerPhone"
                  type="tel"
                  required
                  value={modalPhone}
                  onChange={(e) => {
                    setModalPhone(e.target.value)
                    setIsSavedNumber(false)
                  }}
                  placeholder="07XXXXXXXX"
                  inputMode="tel"
                  autoFocus
                  className="w-full rounded-xl border border-white/[0.08] bg-black/50 px-4 py-3.5 text-base text-white outline-none placeholder:text-zinc-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                />
                <p className="text-xs text-zinc-600">The number that will receive the M-Pesa prompt</p>

                {/* Remember toggle */}
                <label className="flex cursor-pointer items-center gap-2.5">
                  <div
                    onClick={() => setRememberPhone(p => !p)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                      rememberPhone ? 'bg-blue-600' : 'bg-white/10'
                    }`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
                      rememberPhone ? 'translate-x-4' : 'translate-x-0.5'
                    }`} />
                  </div>
                  <span className="text-xs text-zinc-400">Remember this number for next time</span>
                </label>
              </div>

              <SubmitButton label={amount ? `Confirm & Pay ${Number(amount).toLocaleString()} TZS` : 'Confirm & Pay'} disabled={!amount || Number(amount) <= 0} />
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
