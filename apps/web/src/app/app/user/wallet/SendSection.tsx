'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { sendNtzsAction, type SendNtzsResult } from './actions'

interface SendSectionProps {
  walletAddress: string
  renderLauncher?: boolean
}

export function SendSection({ walletAddress, renderLauncher = true }: SendSectionProps) {
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

  // Open via TopActions event
  useEffect(() => {
    const onOpen = () => { reset(); setOpen(true) }
    window.addEventListener('wallet:openSend', onOpen)
    return () => window.removeEventListener('wallet:openSend', onOpen)
  }, [])

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
      {renderLauncher && (
        <button
          type="button"
          onClick={() => { reset(); setOpen(true) }}
          className="flex min-h-[128px] w-full flex-col items-start justify-between rounded-[28px] border border-border/40 bg-card/70 p-5 text-left text-foreground shadow-[0_30px_90px_rgba(3,7,18,0.32)] backdrop-blur-2xl transition-transform duration-300 hover:-translate-y-1"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/40 bg-background/40">
            <svg className="h-5 w-5 text-foreground/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold">Send TZS</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Transfer funds to a wallet address or an alias.</p>
          </div>
        </button>
      )}

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={handleClose}
            />

            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="w-full max-w-lg rounded-[28px] border border-border/40 bg-card/90 p-6 shadow-[0_30px_90px_rgba(3,7,18,0.4)] backdrop-blur-2xl" role="dialog" aria-modal="true">

              {result?.success ? (
                <div className="space-y-5 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/25">
                    <svg className="h-7 w-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">Sent!</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {result.amountTzs.toLocaleString(undefined, { maximumFractionDigits: 4 })} nTZS
                      {' '}sent to{' '}
                      <span className="font-mono text-xs text-foreground/80">
                        {result.toAddress.slice(0, 6)}…{result.toAddress.slice(-4)}
                      </span>
                    </p>
                  </div>
                  <a
                    href={`${BASE_SCAN}${result.mintTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border/40 bg-background/35 px-3 py-2 text-xs font-mono text-foreground/80 backdrop-blur-xl transition-colors hover:bg-background/45"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    View on BaseScan
                  </a>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-opacity duration-75 active:scale-[0.98] hover:opacity-90"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-foreground inline-flex items-center gap-2">
                      Send
                      <span className="inline-flex items-center gap-1">
                        <img src="/ntzs-icon.svg" alt="nTZS icon" className="h-4 w-4" />
                        nTZS
                      </span>
                    </h2>
                    <button type="button" onClick={handleClose} className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-background/40 hover:text-foreground">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 rounded-xl border border-border/40 bg-background/35 px-3 py-2 backdrop-blur-xl">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span className="text-[11px] font-medium text-muted-foreground">Base network only — nTZS lives on Base</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-muted-foreground">To</label>
                    <input
                      type="text"
                      value={to}
                      onChange={(e) => { setTo(e.target.value); setResult(null) }}
                      placeholder="0x… address or @alias"
                      required
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full rounded-2xl border border-border/40 bg-background/35 px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-muted-foreground">Amount</label>
                    <div className="flex items-center gap-2 rounded-2xl border border-border/40 bg-background/35 px-4 py-3 focus-within:border-border focus-within:ring-1 focus-within:ring-ring">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => { setAmount(e.target.value); setResult(null) }}
                        placeholder="0.00"
                        min="0.000001"
                        step="any"
                        required
                        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                      />
                      <span className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1">
                        <img src="/ntzs-icon.svg" alt="nTZS icon" className="h-3.5 w-3.5" />
                        nTZS
                      </span>
                    </div>
                  </div>

                  {result && !result.success && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300 ring-1 ring-rose-500/20"
                    >
                      {result.error}
                    </motion.p>
                  )}

                  <button
                    type="submit"
                    disabled={isPending || !to.trim() || !amount.trim()}
                    className="w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-opacity duration-75 disabled:opacity-50 active:scale-[0.98] hover:opacity-90"
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
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
