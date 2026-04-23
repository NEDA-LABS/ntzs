'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'

import { createWithdrawRequestAction } from './actions'

const SAFE_BURN_THRESHOLD_TZS = 100000
const PLATFORM_FEE_PERCENT = 0.5
const SNIPPE_FLAT_FEE_TZS = 1500

// Gross-up: nTZS to burn = ceil((receiveAmount + snippeFee) / (1 - platformFeeRate))
function calcBurnAmount(receiveAmount: number): number {
  return Math.ceil((receiveAmount + SNIPPE_FLAT_FEE_TZS) / (1 - PLATFORM_FEE_PERCENT / 100))
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-opacity active:scale-[0.98] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <Spinner className="h-4 w-4" />
          Submitting
        </span>
      ) : (
        'Withdraw'
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

  const receiveNum = Number(amount)
  const validAmount = receiveNum >= 5000
  const burnAmount = validAmount ? calcBurnAmount(receiveNum) : 0
  const platformFee = burnAmount > 0 ? burnAmount - receiveNum - SNIPPE_FLAT_FEE_TZS : 0
  const requiresApproval = burnAmount >= SAFE_BURN_THRESHOLD_TZS

  if (submitted) {
    return (
      <div className="overflow-hidden rounded-[28px] border border-border/40 bg-card/90 shadow-[0_30px_90px_rgba(3,7,18,0.4)] backdrop-blur-2xl">
        <div className="space-y-5 p-6 text-center">
          <div
            className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ring-1 ${
              requiresApproval
                ? 'bg-amber-500/15 ring-amber-500/25'
                : 'bg-emerald-500/15 ring-emerald-500/25'
            }`}
          >
            <svg
              className={`h-7 w-7 ${requiresApproval ? 'text-amber-400' : 'text-emerald-400'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div>
            <p className="text-lg font-bold text-foreground">
              {requiresApproval ? 'Queued for approval' : 'Withdrawal submitted'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {requiresApproval
                ? 'Large withdrawals require admin review before payout.'
                : `${Number(amount).toLocaleString()} TZS arriving on mobile money`}
            </p>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <Link
              href="/app/user"
              className="w-full rounded-full bg-primary py-3.5 text-center text-sm font-semibold text-primary-foreground transition-opacity active:scale-[0.98] hover:opacity-90"
            >
              Done
            </Link>
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="w-full rounded-full border border-border/40 bg-background/35 py-3 text-sm font-medium text-muted-foreground backdrop-blur-xl transition-colors hover:bg-background/45 hover:text-foreground"
            >
              Make another withdrawal
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-border/40 bg-card/90 shadow-[0_30px_90px_rgba(3,7,18,0.4)] backdrop-blur-2xl">
      <form
        action={async (formData: FormData) => {
          setError('')
          try {
            const result = await createWithdrawRequestAction(formData)
            if (result.success) {
              setSubmitted(true)
            } else {
              setError(result.error)
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong')
          }
        }}
        className="space-y-4 p-6"
      >
        <div className="rounded-2xl border border-border/40 bg-background/35 p-4 space-y-1 backdrop-blur-xl">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">You receive</p>
          <div className="flex items-center gap-3">
            <div className="flex-none inline-flex items-center gap-2 rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-sm font-semibold text-foreground">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/20 text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/30">
                T
              </span>
              TZS
            </div>
            <input
              name="amountTzs"
              type="number"
              min={5000}
              step={1}
              required
              placeholder="0.00"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-right text-xl font-light text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-background/35 p-4 space-y-1 backdrop-blur-xl">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Mobile money</p>
          <div className="flex items-center gap-3">
            <div className="flex-none inline-flex items-center gap-2 rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-sm font-semibold text-foreground">
              <svg className="h-4 w-4 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 3h8a2 2 0 012 2v14a2 2 0 01-2 2H8a2 2 0 01-2-2V5a2 2 0 012-2zm4 16h.01" />
              </svg>
              Snippe
            </div>
            <input
              name="phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07XXXXXXXX"
              className="min-w-0 flex-1 bg-transparent text-right text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
        </div>

        {validAmount && (
          <div className="space-y-1.5 px-1 text-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Network fee</span>
              <span className="font-mono">+{SNIPPE_FLAT_FEE_TZS.toLocaleString()} TZS</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Platform fee ({PLATFORM_FEE_PERCENT}%)</span>
              <span className="font-mono">+{platformFee.toLocaleString()} TZS</span>
            </div>
            <div className="flex items-center justify-between pt-1 text-foreground">
              <span className="font-medium">nTZS to burn</span>
              <span className="font-mono font-semibold">{burnAmount.toLocaleString()}</span>
            </div>
          </div>
        )}

        {receiveNum > 0 && !validAmount && (
          <p className="px-1 text-xs text-rose-400">Minimum receive amount is 5,000 TZS</p>
        )}

        {requiresApproval && validAmount && (
          <div className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300 ring-1 ring-amber-500/20">
            Requires admin approval before processing (≥ 100,000 TZS).
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300 ring-1 ring-rose-500/20">
            {error}
          </div>
        )}

        <SubmitButton disabled={!validAmount || !phone} />

        <p className="text-center text-[11px] text-muted-foreground">
          1:1 burn — TZS sent to your mobile money via Snippe
        </p>
      </form>
    </div>
  )
}
