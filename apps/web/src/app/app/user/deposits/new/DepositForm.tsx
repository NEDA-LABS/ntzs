'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'

import { IconArrowDown, IconBank, IconCard, IconInfo, IconPhone } from '@/app/app/_components/icons'

import { createDepositRequestAction } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-violet-500/25 transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed hover:shadow-violet-500/40"
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
        'Make Deposit'
      )}
    </button>
  )
}

interface DepositFormProps {
  defaultBankId?: string
  userPhone?: string | null
}

export function DepositForm({ defaultBankId, userPhone }: DepositFormProps) {
  const [phone, setPhone] = useState(userPhone || '')

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

      <form action={createDepositRequestAction} className="space-y-5">
        <input type="hidden" name="bankId" value={defaultBankId} />
        <input type="hidden" name="paymentMethod" value="mpesa" />

        <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Pay</span>
            <span className="text-xs text-zinc-600">TZS</span>
          </div>
          <div className="mt-3 flex items-end justify-between gap-4">
            <input
              name="amountTzs"
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

        <div className="flex items-center justify-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <IconArrowDown className="h-5 w-5 text-zinc-300" />
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Receive</span>
            <span className="text-xs text-emerald-300">1:1</span>
          </div>
          <div className="mt-3 flex items-end justify-between gap-4">
            <div className="w-full text-3xl font-semibold tracking-tight text-zinc-500">≈ same amount</div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
                <img src="/ntzs-logo.png" alt="nTZS" className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold text-white">nTZS</span>
            </div>
          </div>
        </div>

        {/* Payment Methods */}
        <div>
          <div className="grid gap-3 sm:grid-cols-3">
            {/* ZenoPay - Active */}
            <button
              type="button"
              className="flex items-center gap-3 rounded-2xl border border-violet-500/40 bg-violet-500/10 px-4 py-4 text-left text-sm text-white"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20">
                <IconPhone className="h-5 w-5 text-violet-300" />
              </span>
              <span>
                <span className="block font-semibold">ZenoPay</span>
                <span className="block text-xs text-violet-300/70">Mobile Money</span>
              </span>
            </button>

            {/* Bank - Soon */}
            <button
              type="button"
              disabled
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-left text-sm opacity-50"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
                <IconBank className="h-5 w-5 text-white/70" />
              </span>
              <span>
                <span className="block font-semibold text-white/80">Bank</span>
                <span className="block text-xs text-white/50">Soon</span>
              </span>
            </button>

            {/* Selcom - Soon */}
            <button
              type="button"
              disabled
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-left text-sm opacity-50"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
                <IconCard className="h-5 w-5 text-white/70" />
              </span>
              <span>
                <span className="block font-semibold text-white/80">Selcom</span>
                <span className="block text-xs text-white/50">Soon</span>
              </span>
            </button>
          </div>
        </div>

        {/* Phone Input for ZenoPay */}
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
          <p className="text-xs text-zinc-500">Enter the number that will receive the M-Pesa prompt</p>
        </div>

        <SubmitButton />

        <div className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <IconInfo className="mt-0.5 h-4 w-4 text-zinc-400" />
          <p className="text-sm text-zinc-400">
            You'll receive an M-Pesa prompt on your phone. Enter your PIN to confirm. Minting happens automatically after payment.
          </p>
        </div>
      </form>
    </div>
  )
}
