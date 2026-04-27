'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

type StableSymbol = 'USDC' | 'USDT'
type TokenSymbol = 'NTZS' | StableSymbol

interface RateInfo {
  expectedOutput: number
  minOutput: number
  midRate: number
  expiresAt: string
  lowLiquidity?: boolean
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

const TOKEN_ICONS: Record<TokenSymbol, string> = {
  NTZS: '/ntzs-icon.svg',
  USDC: '/usdc-logo.svg',
  USDT: '/usdt-logo.svg',
}

const TOKEN_LABELS: Record<TokenSymbol, string> = {
  NTZS: 'nTZS',
  USDC: 'USDC',
  USDT: 'USDT',
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function TokenButton({
  token,
  onChange,
  disabled,
}: {
  token: TokenSymbol
  onChange?: (t: TokenSymbol) => void
  disabled?: boolean
}) {
  const stables: StableSymbol[] = ['USDC', 'USDT']
  const isStable = token !== 'NTZS'

  if (!isStable || !onChange) {
    return (
      <div className="flex-none rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-sm font-semibold text-foreground inline-flex items-center gap-2">
        <img src={TOKEN_ICONS[token]} alt={TOKEN_LABELS[token]} className="h-4 w-4" />
        {TOKEN_LABELS[token]}
      </div>
    )
  }

  return (
    <div className="relative flex-none">
      <select
        value={token}
        onChange={(e) => onChange(e.target.value as TokenSymbol)}
        disabled={disabled}
        className="appearance-none rounded-xl border border-border/40 bg-background/60 pl-8 pr-7 py-2 text-sm font-semibold text-foreground cursor-pointer focus:outline-none disabled:opacity-50"
      >
        {stables.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <img
        src={TOKEN_ICONS[token]}
        alt={TOKEN_LABELS[token]}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4"
      />
      <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  )
}

interface SwapSectionProps {
  renderLauncher?: boolean
}

export function SwapSection({ renderLauncher = true }: SwapSectionProps) {
  const [open, setOpen] = useState(false)
  // ntzsSide: whether NTZS is the "pay" token or the "receive" token
  const [ntzsSide, setNtzsSide] = useState<'pay' | 'receive'>('pay')
  const [stableToken, setStableToken] = useState<StableSymbol>('USDC')
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState(100)

  const [rate, setRate] = useState<RateInfo | null>(null)
  const [rateLoading, setRateLoading] = useState(false)

  const [logs, setLogs] = useState<StatusUpdate[]>([])
  const [swapping, setSwapping] = useState(false)
  const [done, setDone] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const fromToken: TokenSymbol = ntzsSide === 'pay' ? 'NTZS' : stableToken
  const toToken: TokenSymbol   = ntzsSide === 'pay' ? stableToken : 'NTZS'

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    const onOpen = () => { reset(); setOpen(true) }
    window.addEventListener('wallet:openSwap', onOpen)
    return () => window.removeEventListener('wallet:openSwap', onOpen)
  }, [])

  function flip() {
    setNtzsSide(s => s === 'pay' ? 'receive' : 'pay')
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

  function handleStableChange(token: TokenSymbol) {
    setStableToken(token as StableSymbol)
    setRate(null)
    setAmount('')
  }

  async function fetchRate(amt: string, ft: TokenSymbol = fromToken, tt: TokenSymbol = toToken) {
    if (!amt || parseFloat(amt) <= 0) { setRate(null); return }
    setRateLoading(true)
    try {
      const res = await fetch(`/api/v1/swap/rate?from=${ft}&to=${tt}&amount=${amt}`)
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
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold">Swap assets</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Exchange nTZS for USDC or USDT with live quote previews.</p>
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
              <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-border/40 bg-card/90 shadow-[0_30px_90px_rgba(3,7,18,0.4)] backdrop-blur-2xl" role="dialog" aria-modal="true">
              <div className="p-6 space-y-4 max-h-[85vh] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-foreground">Swap</h2>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-background/40 hover:text-foreground"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {isFilled ? (
                  <div className="space-y-5 text-center py-4">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/25">
                      <svg className="h-7 w-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-foreground">Swap complete!</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {amount} {TOKEN_LABELS[fromToken]} → {TOKEN_LABELS[toToken]}
                      </p>
                    </div>
                    {logs[logs.length - 1]?.txHash && (
                      <a
                        href={`https://basescan.org/tx/${logs[logs.length - 1].txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border/40 bg-background/35 px-3 py-2 text-xs font-mono text-foreground/80 backdrop-blur-xl transition-colors hover:bg-background/45"
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
                      className="w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-opacity active:scale-[0.98] hover:opacity-90"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <>
                    {/* You pay */}
                    <div className="rounded-2xl border border-border/40 bg-background/35 p-4 space-y-1 backdrop-blur-xl">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">You pay</p>
                      <div className="flex items-center gap-3">
                        <TokenButton
                          token={fromToken}
                          onChange={ntzsSide === 'receive' ? handleStableChange : undefined}
                          disabled={swapping}
                        />
                        <input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="0.00"
                          value={amount}
                          onChange={(e) => handleAmountChange(e.target.value)}
                          disabled={swapping}
                          className="min-w-0 flex-1 bg-transparent text-right text-xl font-light text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                        />
                      </div>
                    </div>

                    {/* Flip */}
                    <div className="flex justify-center -my-1">
                      <button
                        type="button"
                        onClick={flip}
                        disabled={swapping}
                        className="rounded-full border border-border/40 bg-background/40 p-2 transition-all hover:bg-background/55 disabled:opacity-40"
                      >
                        <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                      </button>
                    </div>

                    {/* You receive */}
                    <div className="rounded-2xl border border-border/40 bg-background/35 p-4 space-y-1 backdrop-blur-xl">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">You receive</p>
                      <div className="flex items-center gap-3">
                        <TokenButton
                          token={toToken}
                          onChange={ntzsSide === 'pay' ? handleStableChange : undefined}
                          disabled={swapping}
                        />
                        <div className="min-w-0 flex-1 text-right">
                          {rateLoading ? (
                            <Spinner className="ml-auto h-5 w-5 text-muted-foreground" />
                          ) : rate ? (
                            <div className="min-w-0">
                              <p className="truncate text-xl font-light text-foreground">
                                ≈ {rate.expectedOutput.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                              </p>
                              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                min {rate.minOutput.toLocaleString('en-US', { maximumFractionDigits: 4 })} · mid {rate.midRate.toLocaleString()}
                              </p>
                            </div>
                          ) : (
                            <p className="text-xl font-light text-muted-foreground">—</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Slippage */}
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Slippage tolerance</p>
                      <div className="flex gap-1.5">
                        {[50, 100, 200].map(bps => (
                          <button
                            key={bps}
                            type="button"
                            onClick={() => setSlippageBps(bps)}
                            className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                              slippageBps === bps
                                ? 'bg-foreground text-background'
                                : 'border border-border/40 bg-background/35 text-muted-foreground hover:text-foreground/80'
                            }`}
                          >
                            {bps / 100}%
                          </button>
                        ))}
                      </div>
                    </div>

                    {rate?.lowLiquidity && !swapping && !done && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300 ring-1 ring-amber-500/20"
                      >
                        Liquidity is currently low for this swap. Please try a smaller amount or try again later.
                      </motion.div>
                    )}

                    {isFailed && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300 ring-1 ring-rose-500/20"
                      >
                        {logs[logs.length - 1]?.message}
                      </motion.div>
                    )}

                    <button
                      type="button"
                      onClick={swapping ? () => { abortRef.current?.abort(); setSwapping(false); setDone(true) } : startSwap}
                      disabled={!swapping && (!amount || !rate || rateLoading)}
                      className={`w-full py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98] ${
                        swapping
                          ? 'bg-rose-600/10 text-rose-400 ring-1 ring-rose-500/20 hover:bg-rose-600/20'
                          : 'rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40'
                      }`}
                    >
                      {swapping ? (
                        <span className="flex items-center justify-center gap-2">
                          <Spinner className="h-4 w-4" />
                          Cancel
                        </span>
                      ) : isFailed ? 'Try again' : 'Swap'}
                    </button>

                    <AnimatePresence>
                      {logs.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="overflow-hidden rounded-2xl border border-border/40 bg-background/25"
                        >
                          <div className="border-b border-border/40 px-4 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Order status</p>
                          </div>
                          <div className="max-h-48 divide-y divide-border/30 overflow-y-auto">
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
                                      className="mt-0.5 block truncate text-[10px] font-mono text-muted-foreground hover:text-foreground/80"
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
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
