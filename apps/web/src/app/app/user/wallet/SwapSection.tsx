'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

type TokenSymbol = 'NTZS' | 'USDC'

interface RateInfo {
  expectedOutput: number
  minOutput: number
  midRate: number
  expiresAt: string
}

interface StatusUpdate {
  status: string
  message: string
  txHash?: string
}

const STATUS_COLORS: Record<string, string> = {
  CONNECTING: 'text-zinc-400',
  APPROVING: 'text-blue-400',
  APPROVED: 'text-blue-400',
  PREPARING: 'text-zinc-400',
  PLACING_ORDER: 'text-blue-400',
  ORDER_PLACED: 'text-blue-400',
  AWAITING_BIDS: 'text-yellow-400',
  BIDS_RECEIVED: 'text-yellow-400',
  BID_SELECTED: 'text-orange-400',
  USEROP_SUBMITTED: 'text-orange-400',
  PARTIAL_FILL: 'text-orange-400',
  FILLED: 'text-emerald-400',
  FAILED: 'text-rose-400',
  PARTIAL_FILL_EXHAUSTED: 'text-rose-400',
}

const TERMINAL = new Set(['FILLED', 'FAILED', 'PARTIAL_FILL_EXHAUSTED'])

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

interface SwapSectionProps {
  walletAddress: string
}

export function SwapSection({ walletAddress }: SwapSectionProps) {
  const [open, setOpen] = useState(false)
  const [fromToken, setFromToken] = useState<TokenSymbol>('NTZS')
  const [toToken, setToToken] = useState<TokenSymbol>('USDC')
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState(100)

  const [rate, setRate] = useState<RateInfo | null>(null)
  const [rateLoading, setRateLoading] = useState(false)

  const [logs, setLogs] = useState<StatusUpdate[]>([])
  const [swapping, setSwapping] = useState(false)
  const [done, setDone] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll status log
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  function flip() {
    setFromToken(toToken)
    setToToken(fromToken)
    setRate(null)
    setAmount('')
  }

  function reset() {
    setAmount('')
    setRate(null)
    setLogs([])
    setDone(false)
    setSwapping(false)
  }

  function handleClose() {
    if (swapping) abortRef.current?.abort()
    setOpen(false)
    setTimeout(reset, 300)
  }

  async function fetchRate(amt: string) {
    if (!amt || parseFloat(amt) <= 0) { setRate(null); return }
    setRateLoading(true)
    try {
      const res = await fetch(`/api/v1/swap/rate?from=${fromToken}&to=${toToken}&amount=${amt}`)
      if (res.ok) setRate(await res.json())
      else setRate(null)
    } catch {
      setRate(null)
    } finally {
      setRateLoading(false)
    }
  }

  function handleAmountChange(v: string) {
    setAmount(v)
    fetchRate(v)
  }

  async function startSwap() {
    if (!amount || !rate) return
    setLogs([])
    setDone(false)
    setSwapping(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/app/user/wallet/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromToken, toToken, amount: parseFloat(amount), slippageBps }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text()
        setLogs([{ status: 'FAILED', message: text || 'Swap request failed' }])
        setDone(true)
        setSwapping(false)
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return

      let buffer = ''
      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const update: StatusUpdate = JSON.parse(line.slice(6))
            setLogs(prev => [...prev, update])
            if (TERMINAL.has(update.status)) {
              setDone(true)
              setSwapping(false)
              if (update.status === 'FILLED') {
                window.dispatchEvent(new Event('swap:complete'))
              }
            }
          } catch { /* ignore malformed */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setLogs(prev => [...prev, { status: 'FAILED', message: err.message }])
      }
    } finally {
      setSwapping(false)
    }
  }

  const lastStatus = logs[logs.length - 1]?.status
  const isFilled = lastStatus === 'FILLED'
  const isFailed = lastStatus === 'FAILED' || lastStatus === 'PARTIAL_FILL_EXHAUSTED'

  const fromLabel = fromToken === 'NTZS' ? 'nTZS' : 'USDC'
  const toLabel = toToken === 'NTZS' ? 'nTZS' : 'USDC'

  return (
    <>
      {/* Swap button */}
      <button
        type="button"
        onClick={() => { reset(); setOpen(true) }}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-[#12121e] px-5 py-4 text-sm font-semibold text-white ring-1 ring-white/[0.06] transition-all duration-75 hover:bg-white/[0.04] active:scale-[0.98]"
      >
        <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
        Swap
      </button>

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

            {/* Bottom sheet */}
            <motion.div
              className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg rounded-t-3xl bg-[#0f0f1a] ring-1 ring-white/[0.07] pb-safe overflow-hidden"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="h-1 w-10 rounded-full bg-white/10" />
              </div>

              <div className="px-6 pb-6 space-y-4 max-h-[85vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">Swap</h2>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-full p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {isFilled ? (
                  /* ── Success state ── */
                  <div className="space-y-5 text-center py-4">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/25">
                      <svg className="h-7 w-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-white">Swap complete!</p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {amount} {fromLabel} → {toLabel}
                      </p>
                    </div>
                    {logs[logs.length - 1]?.txHash && (
                      <a
                        href={`https://basescan.org/tx/${logs[logs.length - 1].txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-mono text-blue-400 hover:bg-white/10 transition-colors"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        View on BaseScan
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={handleClose}
                      className="w-full rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 transition-all active:scale-[0.98]"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <>
                    {/* ── Swap form ── */}
                    {/* You pay */}
                    <div className="rounded-2xl border border-white/[0.07] bg-black/30 p-4 space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">You pay</p>
                      <div className="flex items-center gap-3">
                        <div className="flex-none rounded-xl bg-zinc-800 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/10">
                          {fromLabel}
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="0.00"
                          value={amount}
                          onChange={(e) => handleAmountChange(e.target.value)}
                          disabled={swapping}
                          className="flex-1 bg-transparent text-right text-2xl font-light text-white placeholder:text-zinc-700 focus:outline-none disabled:opacity-50"
                        />
                      </div>
                    </div>

                    {/* Flip button */}
                    <div className="flex justify-center -my-1">
                      <button
                        type="button"
                        onClick={flip}
                        disabled={swapping}
                        className="p-2 rounded-full border border-white/[0.08] bg-[#0f0f1a] hover:border-blue-500/30 hover:bg-blue-600/5 transition-all disabled:opacity-40"
                      >
                        <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                      </button>
                    </div>

                    {/* You receive */}
                    <div className="rounded-2xl border border-white/[0.07] bg-black/30 p-4 space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">You receive</p>
                      <div className="flex items-center gap-3">
                        <div className="flex-none rounded-xl bg-zinc-800 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/10">
                          {toLabel}
                        </div>
                        <div className="flex-1 text-right">
                          {rateLoading ? (
                            <Spinner className="h-5 w-5 text-zinc-600 ml-auto" />
                          ) : rate ? (
                            <div>
                              <p className="text-2xl font-light text-white">
                                ≈ {rate.expectedOutput.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                              </p>
                              <p className="text-[11px] text-zinc-600 mt-0.5">
                                min {rate.minOutput.toLocaleString('en-US', { maximumFractionDigits: 4 })} · mid {rate.midRate.toLocaleString()}
                              </p>
                            </div>
                          ) : (
                            <p className="text-2xl font-light text-zinc-700">—</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Slippage */}
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-zinc-600">Slippage tolerance</p>
                      <div className="flex gap-1.5">
                        {[50, 100, 200].map(bps => (
                          <button
                            key={bps}
                            type="button"
                            onClick={() => setSlippageBps(bps)}
                            className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                              slippageBps === bps
                                ? 'bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30'
                                : 'bg-zinc-900 text-zinc-500 ring-1 ring-white/5 hover:text-zinc-300'
                            }`}
                          >
                            {bps / 100}%
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Error state */}
                    {isFailed && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300 ring-1 ring-rose-500/20"
                      >
                        {logs[logs.length - 1]?.message}
                      </motion.div>
                    )}

                    {/* Swap / Cancel button */}
                    <button
                      type="button"
                      onClick={swapping ? () => { abortRef.current?.abort(); setSwapping(false); setDone(true) } : startSwap}
                      disabled={!swapping && (!amount || !rate || rateLoading)}
                      className={`w-full py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98] ${
                        swapping
                          ? 'bg-rose-600/10 text-rose-400 ring-1 ring-rose-500/20 hover:bg-rose-600/20'
                          : 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/25 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-blue-500/40'
                      }`}
                    >
                      {swapping ? (
                        <span className="flex items-center justify-center gap-2">
                          <Spinner className="h-4 w-4" />
                          Cancel
                        </span>
                      ) : isFailed ? 'Try again' : 'Swap'}
                    </button>

                    {/* Live status log */}
                    <AnimatePresence>
                      {logs.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="rounded-2xl border border-white/[0.06] bg-black/20 overflow-hidden"
                        >
                          <div className="px-4 py-2.5 border-b border-white/[0.05]">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Order status</p>
                          </div>
                          <div className="divide-y divide-white/[0.04] max-h-48 overflow-y-auto">
                            {logs.map((log, i) => (
                              <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                                <div className="mt-0.5 flex-none">
                                  {log.status === 'FILLED' ? (
                                    <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : log.status === 'FAILED' || log.status === 'PARTIAL_FILL_EXHAUSTED' ? (
                                    <svg className="h-3.5 w-3.5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  ) : (
                                    <Spinner className="h-3.5 w-3.5 text-blue-400" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-xs ${STATUS_COLORS[log.status] ?? 'text-zinc-400'}`}>{log.message}</p>
                                  {log.txHash && (
                                    <a
                                      href={`https://basescan.org/tx/${log.txHash}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 truncate block mt-0.5"
                                    >
                                      {log.txHash.slice(0, 18)}…{log.txHash.slice(-6)}
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))}
                            <div ref={logsEndRef} />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
