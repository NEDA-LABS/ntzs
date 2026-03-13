'use client'

import { useRef, useState, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Loader2 } from 'lucide-react'

import { SavingsCard, type SavingsProduct, type SavingsPosition } from '@/components/ui/savings-card'
import { depositToSavings } from '../actions'

interface SavingsDepositProps {
  product: SavingsProduct
  position: SavingsPosition | null
}

export function SavingsDeposit({ product, position }: SavingsDepositProps) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const minDeposit = product.minDepositTzs
  const parsed = Number(amount.replace(/,/g, ''))

  function openModal() {
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

  function handleSubmit() {
    setError(null)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a valid amount.')
      return
    }
    if (minDeposit > 0 && parsed < minDeposit) {
      setError(`Minimum deposit is ${minDeposit.toLocaleString()} TZS.`)
      return
    }

    startTransition(async () => {
      const result = await depositToSavings(parsed, product.id)
      if (result.success) {
        setDone(true)
        setTimeout(() => setOpen(false), 1400)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <>
      <SavingsCard
        product={product}
        position={position}
        onSaveTap={openModal}
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

            {/* Sheet */}
            <motion.div
              className="fixed bottom-0 left-0 right-0 z-[410] mx-auto max-w-lg rounded-t-3xl border border-white/[0.08] bg-[#16161f] px-5 pt-5 pb-10 shadow-2xl"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            >
              {/* Handle */}
              <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/10" />

              {/* Header */}
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-base font-semibold text-white">
                    {position ? 'Add to Savings' : 'Start Saving'}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Earns {product.annualRateBps / 100}% p.a., accrued daily
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  disabled={isPending}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-zinc-400 transition hover:bg-white/[0.10]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {done ? (
                <motion.div
                  className="flex flex-col items-center gap-2 py-8"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
                    <svg className="h-7 w-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-white">Deposit confirmed</p>
                  <p className="text-xs text-zinc-500">{parsed.toLocaleString()} TZS added to savings</p>
                </motion.div>
              ) : (
                <>
                  {/* Amount input */}
                  <div className="mb-4">
                    <div className="flex items-center gap-3 rounded-2xl bg-white/[0.05] px-4 py-3.5 ring-1 ring-white/[0.08] focus-within:ring-violet-500/50 transition-all">
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
                    {minDeposit > 0 && (
                      <p className="mt-1.5 text-[11px] text-zinc-600">
                        Minimum {minDeposit.toLocaleString()} TZS
                      </p>
                    )}
                  </div>

                  {/* Quick amounts */}
                  <div className="mb-5 flex gap-2">
                    {[5000, 10000, 50000].map((v) => (
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
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-blue-500 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/40 transition active:scale-[0.98] disabled:opacity-50"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing...
                      </>
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
