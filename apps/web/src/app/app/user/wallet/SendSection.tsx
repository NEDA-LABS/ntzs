'use client'

import { useRef, useState, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { sendNtzsAction, type SendNtzsResult } from './actions'

interface SendSectionProps {
  walletAddress: string
}

export function SendSection({ walletAddress }: SendSectionProps) {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [result, setResult] = useState<SendNtzsResult | null>(null)
  const [isPending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function reset() {
    setTo('')
    setAmount('')
    setResult(null)
  }

  function handleClose() {
    setOpen(false)
    setTimeout(reset, 300)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.set('to', to.trim())
    fd.set('amount', amount.trim())
    startTransition(async () => {
      const res = await sendNtzsAction(fd)
      setResult(res)
    })
  }

  const BASE_SCAN = 'https://basescan.org/tx/'

  return (
    <>
      {/* Send button */}
      <button
        type="button"
        onClick={() => { reset(); setOpen(true) }}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-[#12121e] px-5 py-4 text-sm font-semibold text-white ring-1 ring-white/[0.06] transition-all duration-75 hover:bg-white/[0.04] active:scale-[0.98]"
      >
        <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
        Send nTZS
      </button>

      {/* Modal backdrop + panel */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={handleClose}
            />

            {/* Sheet */}
            <motion.div
              className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg rounded-t-3xl bg-[#0f0f1a] p-6 ring-1 ring-white/[0.07] pb-safe"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            >
              {/* Drag handle */}
              <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/10" />

              {result?.success ? (
                /* ── Success state ── */
                <div className="space-y-5 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/25">
                    <svg className="h-7 w-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-white">Sent!</p>
                    <p className="mt-1 text-sm text-zinc-400">
                      {result.amountTzs.toLocaleString(undefined, { maximumFractionDigits: 4 })} nTZS
                      {' '}sent to{' '}
                      <span className="font-mono text-xs text-zinc-300">
                        {result.toAddress.slice(0, 6)}…{result.toAddress.slice(-4)}
                      </span>
                    </p>
                  </div>
                  <a
                    href={`${BASE_SCAN}${result.mintTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-mono text-blue-400 hover:bg-white/10 transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    View on BaseScan
                  </a>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 active:scale-[0.98] hover:shadow-blue-500/40"
                  >
                    Done
                  </button>
                </div>
              ) : (
                /* ── Send form ── */
                <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-white">Send nTZS</h2>
                    <button type="button" onClick={handleClose} className="rounded-full p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white transition-colors">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Network badge */}
                  <div className="flex items-center gap-1.5 rounded-xl bg-blue-600/10 px-3 py-2 ring-1 ring-blue-600/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                    <span className="text-[11px] font-medium text-blue-400">Base network only — nTZS lives on Base</span>
                  </div>

                  {/* To field */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-zinc-500">To</label>
                    <input
                      type="text"
                      value={to}
                      onChange={(e) => { setTo(e.target.value); setResult(null) }}
                      placeholder="0x… address or @alias"
                      required
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full rounded-2xl border border-white/[0.07] bg-black/30 px-4 py-3 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                    />
                  </div>

                  {/* Amount field */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-zinc-500">Amount</label>
                    <div className="flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-black/30 px-4 py-3 focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/30">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => { setAmount(e.target.value); setResult(null) }}
                        placeholder="0.00"
                        min="0.000001"
                        step="any"
                        required
                        className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                      />
                      <span className="text-xs font-semibold text-zinc-500">nTZS</span>
                    </div>
                  </div>

                  {/* Error */}
                  {result && !result.success && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300 ring-1 ring-rose-500/20"
                    >
                      {result.error}
                    </motion.p>
                  )}

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={isPending || !to.trim() || !amount.trim()}
                    className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 disabled:opacity-50 active:scale-[0.98] hover:shadow-blue-500/40"
                  >
                    {isPending ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        Sending…
                      </span>
                    ) : 'Send nTZS'}
                  </button>
                </form>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
