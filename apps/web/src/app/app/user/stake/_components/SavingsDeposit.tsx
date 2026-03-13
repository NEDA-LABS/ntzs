'use client'

import { useRef, useState, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Loader2 } from 'lucide-react'

import { SavingsCard, type SavingsProduct, type SavingsPosition } from '@/components/ui/savings-card'
import { depositToSavings, withdrawFromSavings } from '../actions'

type Mode = 'deposit' | 'withdraw'

interface SavingsDepositProps {
  product: SavingsProduct
  position: SavingsPosition | null
}

export function SavingsDeposit({ product, position }: SavingsDepositProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('deposit')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const minDeposit = product.minDepositTzs
  const maxWithdraw = position?.principalTzs ?? 0
  const parsed = Number(amount)

  function openSheet(m: Mode) {
    setMode(m)
    setAmount('')
    setError(null)
    setDone(false)
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 80)
  }

  function close() {
    if (isPending) return
    setOpen(false)
  }

  function switchMode(m: Mode) {
    setMode(m)
    setAmount('')
    setError(null)
  }

  function handleSubmit() {
    setError(null)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a valid amount.')
      return
    }

    if (mode === 'deposit') {
      if (minDeposit > 0 && parsed < minDeposit) {
        setError(`Minimum deposit is ${minDeposit.toLocaleString()} TZS.`)
        return
      }
      startTransition(async () => {
        const result = await depositToSavings(parsed, product.id)
        if (result.success) { setDone(true); setTimeout(() => setOpen(false), 1400) }
        else setError(result.error)
      })
    } else {
      if (parsed > maxWithdraw) {
        setError(`Maximum withdrawal is ${maxWithdraw.toLocaleString()} TZS.`)
        return
      }
      startTransition(async () => {
        const result = await withdrawFromSavings(parsed, product.id)
        if (result.success) { setDone(true); setTimeout(() => setOpen(false), 1400) }
        else setError(result.error)
      })
    }
  }

  const isWithdraw = mode === 'withdraw'
  const hasFunds = !!position && position.principalTzs > 0

  return (
    <>
      <SavingsCard
        product={product}
        position={position}
        onSaveTap={() => openSheet('deposit')}
        onWithdrawTap={hasFunds ? () => openSheet('withdraw') : undefined}
        className="w-full"
      />

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 z-[400] bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={close}
            />

            {/* Modal */}
            <motion.div
              className="fixed left-1/2 top-1/2 z-[410] w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/[0.08] bg-[#16161f] px-5 pt-5 pb-7 shadow-2xl"
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            >

              {/* Header */}
              <div className="mb-4 flex items-center justify-between">
                <p className="text-base font-semibold text-white">Savings</p>
                <button
                  type="button"
                  onClick={close}
                  disabled={isPending}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-zinc-400 transition hover:bg-white/[0.10]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Tabs — only show withdraw tab if user has funds */}
              {hasFunds && (
                <div className="mb-5 flex gap-1 rounded-xl bg-white/[0.04] p-1">
                  {(['deposit', 'withdraw'] as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => switchMode(m)}
                      disabled={isPending}
                      className={`flex-1 rounded-lg py-2 text-xs font-semibold capitalize transition ${
                        mode === m
                          ? 'bg-white/[0.09] text-white'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}

              {done ? (
                <motion.div
                  className="flex flex-col items-center gap-2 py-8"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  <div className={`flex h-14 w-14 items-center justify-center rounded-full ${isWithdraw ? 'bg-rose-500/12' : 'bg-emerald-500/15'}`}>
                    <svg className={`h-7 w-7 ${isWithdraw ? 'text-rose-300' : 'text-emerald-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-white">
                    {isWithdraw ? 'Withdrawal confirmed' : 'Deposit confirmed'}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {parsed.toLocaleString()} TZS {isWithdraw ? 'unlocked from savings' : 'added to savings'}
                  </p>
                  {isWithdraw && (
                    <p className="mt-1 text-center text-[11px] text-zinc-600">
                      Funds will be returned to your wallet within 24 hours
                    </p>
                  )}
                </motion.div>
              ) : (
                <>
                  {/* Context info */}
                  {isWithdraw && hasFunds && (
                    <div className="mb-4 flex items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-3">
                      <span className="text-xs text-zinc-500">Available to withdraw</span>
                      <span className="font-mono text-sm font-semibold text-white">
                        {maxWithdraw.toLocaleString()} TZS
                      </span>
                    </div>
                  )}

                  {/* Amount input */}
                  <div className="mb-4">
                    <div className={`flex items-center gap-3 rounded-2xl bg-white/[0.05] px-4 py-3.5 ring-1 transition-all focus-within:ring-opacity-100 ${isWithdraw ? 'ring-white/[0.08] focus-within:ring-rose-500/50' : 'ring-white/[0.08] focus-within:ring-violet-500/50'}`}>
                      <input
                        ref={inputRef}
                        type="number"
                        inputMode="numeric"
                        placeholder="0"
                        value={amount}
                        onChange={(e) => { setAmount(e.target.value); setError(null) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
                        disabled={isPending}
                        className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-white placeholder-white/20 outline-none disabled:opacity-50"
                      />
                      <span className="shrink-0 text-sm font-medium text-zinc-500">TZS</span>
                    </div>
                    {!isWithdraw && minDeposit > 0 && (
                      <p className="mt-1.5 text-[11px] text-zinc-600">
                        Minimum {minDeposit.toLocaleString()} TZS
                      </p>
                    )}
                  </div>

                  {/* Quick amounts */}
                  <div className="mb-5 flex gap-2">
                    {isWithdraw
                      ? [Math.floor(maxWithdraw * 0.25), Math.floor(maxWithdraw * 0.5), maxWithdraw]
                          .filter((v) => v > 0)
                          .map((v, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => { setAmount(String(v)); setError(null) }}
                              disabled={isPending}
                              className="rounded-xl bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-zinc-400 ring-1 ring-white/[0.06] transition hover:bg-white/[0.09] disabled:opacity-40"
                            >
                              {i === 0 ? '25%' : i === 1 ? '50%' : 'All'}
                            </button>
                          ))
                      : [5000, 10000, 50000].map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => { setAmount(String(v)); setError(null) }}
                            disabled={isPending}
                            className="rounded-xl bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-zinc-400 ring-1 ring-white/[0.06] transition hover:bg-white/[0.09] disabled:opacity-40"
                          >
                            {v.toLocaleString()}
                          </button>
                        ))}
                  </div>

                  {/* Error */}
                  {error && (
                    <p className="mb-4 rounded-xl bg-rose-500/10 px-3 py-2.5 text-xs text-rose-400">
                      {error}
                    </p>
                  )}

                  {/* Confirm button */}
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isPending || !amount}
                    className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-50 ${
                      isWithdraw
                        ? 'bg-gradient-to-r from-rose-600 to-rose-500 shadow-rose-900/40'
                        : 'bg-gradient-to-r from-blue-600 to-blue-500 shadow-blue-900/40'
                    }`}
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : isWithdraw ? (
                      'Confirm Withdrawal'
                    ) : (
                      'Confirm Deposit'
                    )}
                  </button>
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
