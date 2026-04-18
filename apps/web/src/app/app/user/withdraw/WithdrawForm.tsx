'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'

import { IconInfo, IconPhone } from '@/app/app/_components/icons'

import { createWithdrawRequestAction } from './actions'

const SAFE_BURN_THRESHOLD_TZS = 100000
const PLATFORM_FEE_PERCENT = 0.5
const SNIPPE_FLAT_FEE_TZS = 1500
// Gross-up: nTZS to burn = ceil((receiveAmount + snippeFee) / (1 - platformFeeRate))
function calcBurnAmount(receiveAmount: number): number {
  return Math.ceil((receiveAmount + SNIPPE_FLAT_FEE_TZS) / (1 - PLATFORM_FEE_PERCENT / 100))
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-2xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground transition-opacity duration-75 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100 hover:opacity-90"
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

  const receiveNum = Number(amount)
  const burnAmount = receiveNum >= 5000 ? calcBurnAmount(receiveNum) : 0
  const platformFee = burnAmount > 0 ? burnAmount - receiveNum - SNIPPE_FLAT_FEE_TZS : 0
  const requiresApproval = burnAmount >= SAFE_BURN_THRESHOLD_TZS
  const showFees = receiveNum >= 5000

  if (submitted) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border/40 bg-background/35 backdrop-blur-xl">
        <div className="px-6 py-10 text-center">
          <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" style={{ animationDuration: '1.4s', animationIterationCount: '1' as unknown as number }} />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/30">
              <svg className="h-9 w-9 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>

          {requiresApproval ? (
            <>
              <h2 className="mt-5 text-xl font-bold text-foreground">Queued for approval</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Large withdrawals require admin review. You will receive a mobile money payout once approved.</p>
              <div className="mx-auto mt-5 w-fit rounded-2xl bg-amber-500/10 px-6 py-3 ring-1 ring-amber-500/20">
                <p className="text-2xl font-bold tabular-nums text-amber-300">{Number(amount).toLocaleString()} TZS</p>
                <p className="mt-0.5 text-xs text-amber-400/60">pending approval</p>
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-5 text-xl font-bold text-foreground">Withdrawal submitted</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Your nTZS has been burned. The TZS payout will arrive on your mobile money shortly.</p>
              <div className="mx-auto mt-5 w-fit rounded-2xl bg-emerald-500/10 px-6 py-3 ring-1 ring-emerald-500/20">
                <p className="text-2xl font-bold tabular-nums text-emerald-400">{Number(amount).toLocaleString()} TZS</p>
                <p className="mt-0.5 text-xs text-emerald-400/60">arriving on mobile money</p>
              </div>
            </>
          )}

          <div className="mt-7 flex flex-col gap-3">
            <Link
              href="/app/user"
              className="w-full rounded-2xl bg-primary px-6 py-4 text-center text-base font-semibold text-primary-foreground transition-opacity duration-75 active:scale-[0.98] hover:opacity-90"
            >
              Go to Dashboard
            </Link>
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="w-full rounded-2xl border border-border/40 bg-background/35 px-6 py-4 text-base font-medium text-foreground backdrop-blur-xl transition-all duration-75 active:scale-[0.98] hover:bg-background/45"
            >
              Make another withdrawal
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/40 bg-background/35 p-6 backdrop-blur-xl">

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
        className="space-y-5"
      >
        {/* Receive amount */}
        <div className="rounded-2xl border border-border/40 bg-background/35 p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">You receive</span>
            <span className="text-xs text-muted-foreground">on mobile money</span>
          </div>
          <div className="mt-3 flex items-end justify-between gap-4">
            <input
              name="amountTzs"
              type="number"
              min={5000}
              step={1}
              required
              placeholder="0"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-transparent text-4xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-background/35 px-3 py-2 backdrop-blur-xl">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20">
                <span className="text-sm font-semibold">T</span>
              </div>
              <span className="text-sm font-semibold text-foreground">TZS</span>
            </div>
          </div>
          {receiveNum > 0 && receiveNum < 5000 && (
            <p className="mt-2 text-xs text-rose-400">Minimum receive amount is 5,000 TZS</p>
          )}
        </div>

        {/* Payout method */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Payout method</p>
          <div className="flex items-center gap-3 rounded-2xl border border-blue-500/30 bg-blue-600/10 px-4 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20">
              <IconPhone className="h-5 w-5 text-blue-300" />
            </span>
            <span>
              <span className="block font-semibold text-foreground">Snippe</span>
              <span className="block text-xs text-blue-300/70">Mobile Money</span>
            </span>
          </div>
        </div>

        {/* Phone */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">Mobile Money Number</label>
          <input
            name="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="07XXXXXXXX"
            className="w-full rounded-2xl border border-border/40 bg-background/35 px-4 py-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-ring backdrop-blur-xl"
          />
          <p className="text-xs text-muted-foreground">TZS will be sent to this number via Snippe</p>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {requiresApproval && receiveNum > 0 && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
            <IconInfo className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" />
            <p className="text-sm text-amber-300">
              This withdrawal requires admin approval before processing (burn amount ≥ 100,000 TZS).
            </p>
          </div>
        )}

        {showFees && (
          <div className="rounded-2xl border border-border/40 bg-background/35 p-4 space-y-2.5 backdrop-blur-xl">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cost breakdown</p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">You receive</span>
                <span className="font-mono font-semibold text-emerald-400">{receiveNum.toLocaleString()} TZS</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Network fee (Snippe)</span>
                <span className="font-mono text-muted-foreground">+{SNIPPE_FLAT_FEE_TZS.toLocaleString()} TZS</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Platform fee ({PLATFORM_FEE_PERCENT}%)</span>
                <span className="font-mono text-muted-foreground">+{platformFee.toLocaleString()} TZS</span>
              </div>
              <div className="h-px bg-border/60" />
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">nTZS to burn</span>
                <span className="font-mono font-semibold text-foreground">{burnAmount.toLocaleString()} TZS</span>
              </div>
            </div>
          </div>
        )}

        <SubmitButton />

        {!showFees && (
          <div className="flex items-start gap-2 rounded-2xl border border-border/40 bg-background/35 p-4 backdrop-blur-xl">
            <IconInfo className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">
              Your nTZS is burned (1:1) and the equivalent TZS is sent to your mobile money account. Minimum withdrawal is 5,000 TZS.
            </p>
          </div>
        )}
      </form>
    </div>
  )
}
