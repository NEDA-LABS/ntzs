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
      className="w-full rounded-2xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-[0_18px_40px_-20px_rgba(255,255,255,0.45)] transition-all duration-150 hover:opacity-95 hover:shadow-[0_22px_46px_-22px_rgba(255,255,255,0.5)] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-none disabled:active:scale-100"
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
      <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0.02)_100%)] p-5 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-6">
        <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-3 text-left">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Withdrawal status</p>
          <p className="mt-1 text-sm text-zinc-300">
            {requiresApproval ? 'Awaiting admin approval before payout' : 'Burn completed and payout is being processed'}
          </p>
        </div>

        <div className="px-2 py-8 text-center sm:px-4 sm:py-10">
          <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
            <div
              className={`absolute inset-0 rounded-full animate-ping ${requiresApproval ? 'bg-amber-500/15' : 'bg-emerald-500/15'}`}
              style={{ animationDuration: '1.4s', animationIterationCount: '1' as unknown as number }}
            />
            <div
              className={`relative flex h-24 w-24 items-center justify-center rounded-full ring-1 ${requiresApproval ? 'bg-amber-500/12 ring-amber-500/25' : 'bg-emerald-500/12 ring-emerald-500/25'}`}
            >
              <svg
                className={`h-10 w-10 ${requiresApproval ? 'text-amber-300' : 'text-emerald-400'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>

          {requiresApproval ? (
            <>
              <h2 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Queued for approval</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-400">
                Large withdrawals require admin review before the mobile money payout is released.
              </p>
              <div className="mx-auto mt-6 max-w-sm rounded-[24px] border border-amber-500/15 bg-amber-500/10 p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/70">Pending amount</span>
                  <span className="rounded-full border border-amber-400/15 bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/85">Review</span>
                </div>
                <p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-amber-300">{Number(amount).toLocaleString()} TZS</p>
                <p className="mt-2 text-sm text-amber-200/75">You will receive a payout after approval is completed.</p>
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Withdrawal submitted</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-400">
                Your nTZS has been burned and the TZS payout is now moving through the mobile money rail.
              </p>
              <div className="mx-auto mt-6 max-w-sm rounded-[24px] border border-emerald-500/15 bg-emerald-500/10 p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/70">Payout amount</span>
                  <span className="rounded-full border border-emerald-400/15 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200/85">Processing</span>
                </div>
                <p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-emerald-400">{Number(amount).toLocaleString()} TZS</p>
                <p className="mt-2 text-sm text-emerald-200/75">Funds should arrive on your mobile money account shortly.</p>
              </div>
            </>
          )}

          <div className="mt-6 rounded-[24px] border border-white/10 bg-black/10 p-4 text-left backdrop-blur-xl">
            <div className="flex items-start gap-3 rounded-2xl bg-white/[0.02] px-3 py-3">
              <IconInfo className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
              <p className="text-sm leading-6 text-zinc-400">
                {requiresApproval
                  ? 'You can leave this page. The withdrawal stays queued while our team reviews it.'
                  : 'You can leave this page. The payout continues processing in the background.'}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <Link
              href="/app/user"
              className="w-full rounded-2xl bg-primary px-6 py-4 text-center text-base font-semibold text-primary-foreground shadow-[0_18px_40px_-20px_rgba(255,255,255,0.45)] transition-all duration-150 hover:opacity-95 hover:shadow-[0_22px_46px_-22px_rgba(255,255,255,0.5)] active:scale-[0.985]"
            >
              Go to dashboard
            </Link>
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-4 text-base font-medium text-foreground transition-all duration-150 hover:bg-white/[0.05] active:scale-[0.985]"
            >
              Make another withdrawal
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0.02)_100%)] p-5 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-6">
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
        className="space-y-4"
      >
        <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Withdraw rail</p>
            <p className="mt-1 text-sm text-zinc-300">Burn nTZS and settle out to mobile money</p>
          </div>
          <div className="rounded-full border border-emerald-400/10 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300/85">
            Live
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-black/20 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">You receive</span>
            <span className="text-xs text-muted-foreground">on mobile money</span>
          </div>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
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
                className="w-full bg-transparent text-5xl font-semibold tracking-[-0.04em] text-foreground outline-none placeholder:text-zinc-600 sm:text-6xl"
              />
              <p className="mt-2 text-xs text-zinc-500">Enter the exact TZS amount the customer should receive</p>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20">
                <span className="text-sm font-semibold">T</span>
              </div>
              <span className="text-sm font-semibold tracking-wide text-foreground">TZS</span>
            </div>
          </div>
          {receiveNum > 0 && receiveNum < 5000 && (
            <p className="mt-3 text-xs text-rose-400">Minimum receive amount is 5,000 TZS</p>
          )}
        </div>

        <div className="rounded-[24px] border border-white/10 bg-black/10 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Payout method</p>
            <span className="text-xs text-zinc-500">Instant rail selection</span>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-blue-500/20 bg-[linear-gradient(180deg,rgba(37,99,235,0.14)_0%,rgba(37,99,235,0.08)_100%)] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/15 ring-1 ring-blue-400/10">
              <IconPhone className="h-5 w-5 text-blue-300" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-foreground">Snippe</span>
              <span className="block text-sm text-blue-200/65">Mobile Money payout</span>
            </div>
            <span className="rounded-full border border-blue-400/15 bg-blue-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-200/80">
              Active
            </span>
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-black/10 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-foreground/90">Mobile money number</label>
            <span className="text-xs text-zinc-500">TZS destination</span>
          </div>
          <input
            name="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="07XXXXXXXX"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-base text-foreground outline-none placeholder:text-zinc-500 transition focus:border-white/15 focus:bg-white/[0.05] focus:ring-2 focus:ring-white/10"
          />
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-500">
            <p>TZS will be sent to this number via Snippe</p>
            <p>Format: 07XXXXXXXX</p>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            {error}
          </div>
        )}

        {requiresApproval && receiveNum > 0 && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
            <IconInfo className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" />
            <p className="text-sm text-amber-300">
              This withdrawal requires admin approval before processing (burn amount ≥ 100,000 TZS).
            </p>
          </div>
        )}

        {showFees && (
          <div className="rounded-[24px] border border-white/10 bg-black/10 p-4 backdrop-blur-xl sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Cost breakdown</p>
              <span className="text-xs text-zinc-500">Transparent fees</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">You receive</span>
                <span className="font-mono font-semibold text-emerald-400">{receiveNum.toLocaleString()} TZS</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Network fee (Snippe)</span>
                <span className="font-mono text-zinc-300">+{SNIPPE_FLAT_FEE_TZS.toLocaleString()} TZS</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Platform fee ({PLATFORM_FEE_PERCENT}%)</span>
                <span className="font-mono text-zinc-300">+{platformFee.toLocaleString()} TZS</span>
              </div>
              <div className="my-3 h-px bg-white/10" />
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">nTZS to burn</span>
                  <span className="font-mono font-semibold text-foreground">{burnAmount.toLocaleString()} TZS</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">Includes payout rail fee and platform fee</p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/10 p-4 sm:p-5">
          <SubmitButton />

          <div className="flex items-start gap-3 rounded-2xl bg-white/[0.02] px-3 py-3">
            <IconInfo className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
            <p className="text-sm leading-6 text-zinc-400">
              Withdrawals below 100,000 TZS process immediately after on-chain burn. Larger withdrawals are queued for approval.
            </p>
          </div>
        </div>

        {!showFees && (
          <div className="flex items-start gap-3 rounded-[24px] border border-white/10 bg-black/10 p-4 backdrop-blur-xl">
            <IconInfo className="mt-0.5 h-4 w-4 text-zinc-500 shrink-0" />
            <p className="text-sm leading-6 text-zinc-400">
              Your nTZS is burned (1:1) and the equivalent TZS is sent to your mobile money account. Minimum withdrawal is 5,000 TZS.
            </p>
          </div>
        )}
      </form>
    </div>
  )
}
