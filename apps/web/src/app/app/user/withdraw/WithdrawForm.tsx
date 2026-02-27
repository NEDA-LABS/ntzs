'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'

import { IconInfo, IconPhone } from '@/app/app/_components/icons'

import { createWithdrawRequestAction } from './actions'

const SAFE_BURN_THRESHOLD_TZS = 100000

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-rose-500/25 transition-all duration-75 active:scale-[0.97] disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100 hover:shadow-rose-500/40"
    >
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Submitting...
        </span>
      ) : (
        'Withdraw to mobile money'
      )}
    </button>
  )
}

interface WithdrawFormProps {
  userPhone?: string | null
}

export function WithdrawForm({ userPhone }: WithdrawFormProps) {
  const [phone, setPhone] = useState(userPhone || '')
  const [amount, setAmount] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const amountNum = Number(amount)
  const requiresApproval = amountNum >= SAFE_BURN_THRESHOLD_TZS

  if (submitted) {
    return (
      <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-xl">
        <div className="absolute inset-0 -z-10 rounded-3xl bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.15),transparent_50%)]" />
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
            <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="mt-6 text-xl font-semibold text-white">Withdrawal submitted</h2>
          <p className="mt-2 text-zinc-400">
            {requiresApproval
              ? 'Your withdrawal requires admin approval. You will receive the payout once approved.'
              : 'Your nTZS is being burned and the TZS payout will arrive on your mobile money shortly.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
      <div className="absolute inset-0 -z-10 rounded-3xl bg-[radial-gradient(circle_at_20%_0%,rgba(220,38,38,0.12),transparent_55%),radial-gradient(circle_at_80%_100%,rgba(0,112,243,0.08),transparent_55%)]" />

      <form
        action={async (formData: FormData) => {
          setError('')
          try {
            await createWithdrawRequestAction(formData)
            setSubmitted(true)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong')
          }
        }}
        className="space-y-5"
      >
        {/* Amount */}
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Withdraw</span>
            <span className="text-xs text-zinc-600">nTZS → TZS</span>
          </div>
          <div className="mt-3 flex items-end justify-between gap-4">
            <input
              name="amountTzs"
              type="number"
              min={1000}
              step={1}
              required
              placeholder="0"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-transparent text-4xl font-semibold tracking-tight text-white outline-none placeholder:text-zinc-700"
            />
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20">
                <span className="text-sm font-semibold">T</span>
              </div>
              <span className="text-sm font-semibold text-white">TZS</span>
            </div>
          </div>
          {amountNum > 0 && amountNum < 1000 && (
            <p className="mt-2 text-xs text-rose-400">Minimum withdrawal is 1,000 TZS</p>
          )}
        </div>

        {/* Payout method */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Payout method</p>
          <div className="flex items-center gap-3 rounded-2xl border border-violet-500/40 bg-violet-500/10 px-4 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20">
              <IconPhone className="h-5 w-5 text-violet-300" />
            </span>
            <span>
              <span className="block font-semibold text-white">Snippe</span>
              <span className="block text-xs text-violet-300/70">Mobile Money</span>
            </span>
          </div>
        </div>

        {/* Phone */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-400">Mobile Money Number</label>
          <input
            name="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="07XXXXXXXX"
            className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none placeholder:text-zinc-600 focus:border-violet-500/50"
          />
          <p className="text-xs text-zinc-500">TZS will be sent to this number via Snippe</p>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {requiresApproval && amountNum > 0 && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
            <IconInfo className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" />
            <p className="text-sm text-amber-300">
              Withdrawals of 9,000 TZS or more require admin approval before processing.
            </p>
          </div>
        )}

        <SubmitButton />

        <div className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <IconInfo className="mt-0.5 h-4 w-4 text-zinc-400 shrink-0" />
          <p className="text-sm text-zinc-400">
            Your nTZS is burned (1:1) and the equivalent TZS is sent to your mobile money account via Snippe. Minimum withdrawal is 1,000 TZS.
          </p>
        </div>
      </form>
    </div>
  )
}
