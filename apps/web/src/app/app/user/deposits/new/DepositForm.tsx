'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'

import { IconBank, IconCard, IconInfo, IconPhone } from '@/app/app/_components/icons'
import { ACTIVE_PSP_NAME, ACTIVE_PSP_METHOD_LABEL } from '@/lib/psp/zenopay'

import { createDepositRequestAction, createCardDepositRequestAction } from './actions'

type PaymentMethod = 'mobile' | 'card'

function SubmitButton() {
  const { pending } = useFormStatus()
  
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-violet-500/25 transition-all duration-75 active:scale-[0.97] active:shadow-violet-500/15 disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100 hover:shadow-violet-500/40"
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
        'Top up wallet'
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
  const [phone, setPhone] = useState(userPhone || '')
  const [submitted, setSubmitted] = useState(false)
  const [submittedAmount, setSubmittedAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('mobile')
  const [cardLoading, setCardLoading] = useState(false)
  const [cardError, setCardError] = useState('')

  if (submitted) {
    return (
      <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-xl">
        <div className="absolute inset-0 -z-10 rounded-3xl bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.15),transparent_50%)]" />
        
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
            <SuccessIcon className="h-8 w-8 text-emerald-400" />
          </div>
          
          <h2 className="mt-6 text-xl font-semibold text-white">Deposit Submitted!</h2>
          <p className="mt-2 text-zinc-400">
            Check your phone for the M-Pesa prompt
          </p>
          
          <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <p className="text-3xl font-bold text-emerald-400">{submittedAmount} TZS</p>
            <p className="mt-1 text-sm text-emerald-300/70">will be minted as nTZS after payment</p>
          </div>

          <div className="mt-6 space-y-3">
            <p className="text-sm text-zinc-500">
              Enter your M-Pesa PIN to confirm. Your nTZS will appear in your wallet automatically.
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-3">
            <Link
              href="/app/user"
              className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 px-6 py-4 text-center text-base font-semibold text-white shadow-lg shadow-violet-500/25 transition-all duration-75 active:scale-[0.98] hover:shadow-violet-500/40"
            >
              Go to Dashboard
            </Link>
            <button
              onClick={() => {
                setSubmitted(false)
                setSubmittedAmount('')
              }}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-base font-medium text-white transition-all duration-75 active:scale-[0.98] active:bg-white/[0.08] hover:bg-white/10"
            >
              Make Another Deposit
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!defaultBankId) {
    return (
      <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
        <div className="py-12 text-center">
          <p className="text-sm text-zinc-400">System not configured yet.</p>
          <p className="mt-1 text-xs text-zinc-600">Please contact support.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
      <div className="absolute inset-0 -z-10 rounded-3xl bg-[radial-gradient(circle_at_20%_0%,rgba(121,40,202,0.16),transparent_55%),radial-gradient(circle_at_80%_100%,rgba(0,112,243,0.10),transparent_55%)]" />

      {/* Amount input — shared between methods */}
      <div className="mb-5 rounded-2xl border border-white/10 bg-black/30 p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Pay</span>
          <span className="text-xs text-zinc-600">TZS</span>
        </div>
        <div className="mt-3 flex items-end justify-between gap-4">
          <input
            id="shared-amount"
            type="number"
            min={1}
            step={1}
            required
            placeholder="0"
            inputMode="numeric"
            className="w-full bg-transparent text-4xl font-semibold tracking-tight text-white outline-none placeholder:text-zinc-700"
          />
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20">
              <span className="text-sm font-semibold">T</span>
            </div>
            <span className="text-sm font-semibold text-white">TZS</span>
          </div>
        </div>
      </div>

      {/* Payment method selector */}
      <div className="mb-5">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Payment method</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {/* Mobile Money */}
          <button
            type="button"
            onClick={() => setMethod('mobile')}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-4 text-left text-sm transition-colors ${
              method === 'mobile'
                ? 'border-violet-500/40 bg-violet-500/10 text-white'
                : 'border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]'
            }`}
          >
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${method === 'mobile' ? 'bg-violet-500/20' : 'bg-white/[0.06]'}`}>
              <IconPhone className={`h-5 w-5 ${method === 'mobile' ? 'text-violet-300' : 'text-white/50'}`} />
            </span>
            <span>
              <span className="block font-semibold">{ACTIVE_PSP_NAME}</span>
              <span className={`block text-xs ${method === 'mobile' ? 'text-violet-300/70' : 'text-white/40'}`}>{ACTIVE_PSP_METHOD_LABEL}</span>
            </span>
          </button>

          {/* Bank — Soon */}
          <button
            type="button"
            disabled
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-left text-sm opacity-40"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
              <IconBank className="h-5 w-5 text-white/70" />
            </span>
            <span>
              <span className="block font-semibold text-white/80">Bank</span>
              <span className="block text-xs text-white/50">Soon</span>
            </span>
          </button>

          {/* Card */}
          <button
            type="button"
            onClick={() => setMethod('card')}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-4 text-left text-sm transition-colors ${
              method === 'card'
                ? 'border-violet-500/40 bg-violet-500/10 text-white'
                : 'border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]'
            }`}
          >
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${method === 'card' ? 'bg-violet-500/20' : 'bg-white/[0.06]'}`}>
              <IconCard className={`h-5 w-5 ${method === 'card' ? 'text-violet-300' : 'text-white/50'}`} />
            </span>
            <span>
              <span className="block font-semibold">Card</span>
              <span className={`block text-xs ${method === 'card' ? 'text-violet-300/70' : 'text-white/40'}`}>Visa / Mastercard</span>
            </span>
          </button>
        </div>
      </div>

      {/* Mobile money form */}
      {method === 'mobile' && (
        <form
          action={async (formData: FormData) => {
            const amount = (document.getElementById('shared-amount') as HTMLInputElement)?.value
            formData.set('amountTzs', amount)
            setSubmittedAmount(amount)
            await createDepositRequestAction(formData)
            setSubmitted(true)
          }}
          className="space-y-4"
        >
          <input type="hidden" name="bankId" value={defaultBankId} />
          <input type="hidden" name="paymentMethod" value="mpesa" />

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-400">Mobile Money Number</label>
            <input
              name="buyerPhone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07XXXXXXXX"
              className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none placeholder:text-zinc-600 focus:border-violet-500/50"
            />
            <p className="text-xs text-zinc-500">Enter the number that will receive the payment prompt</p>
          </div>

          <SubmitButton />

          <div className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <IconInfo className="mt-0.5 h-4 w-4 text-zinc-400" />
            <p className="text-sm text-zinc-400">
              You'll receive a payment prompt on your phone. Enter your PIN to confirm. Your nTZS will be minted automatically after payment.
            </p>
          </div>
        </form>
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
            disabled={cardLoading}
            onClick={async () => {
              const amount = (document.getElementById('shared-amount') as HTMLInputElement)?.value
              if (!amount || Number(amount) <= 0) {
                setCardError('Please enter an amount above')
                return
              }
              setCardError('')
              setCardLoading(true)
              try {
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
            className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-violet-500/25 transition-all duration-75 active:scale-[0.97] disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100 hover:shadow-violet-500/40"
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
              'Pay with Card'
            )}
          </button>

          <div className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <IconInfo className="mt-0.5 h-4 w-4 text-zinc-400" />
            <p className="text-sm text-zinc-400">
              You'll be redirected to a secure card checkout. Accepted: Visa, Mastercard. Your nTZS will be minted automatically after payment.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
