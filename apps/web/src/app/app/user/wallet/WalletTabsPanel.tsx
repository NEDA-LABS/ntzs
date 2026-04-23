"use client"

import { useMemo, useRef, useState, useTransition } from "react"

import { cn } from "@/lib/utils"
import { sendNtzsAction, type SendNtzsResult } from "./actions"

interface WalletTabsPanelProps {
  walletAddress: string
  payAlias: string | null
  suggestedAlias: string
}

export function WalletTabsPanel({ walletAddress, payAlias, suggestedAlias }: WalletTabsPanelProps) {
  const [tab, setTab] = useState<"receive" | "send" | "swap">("receive")
  const [copied, setCopied] = useState(false)
  // Send (inline)
  const [to, setTo] = useState("")
  const [amount, setAmount] = useState("")
  const [sendResult, setSendResult] = useState<SendNtzsResult | null>(null)
  const [isPending, startTransition] = useTransition()
  const BASE_SCAN = "https://basescan.org/tx/"
  // Swap (inline quote)
  const [fromToken, setFromToken] = useState<"NTZS" | "USDC">("NTZS")
  const toToken = fromToken === "NTZS" ? "USDC" : "NTZS"
  const [swapAmount, setSwapAmount] = useState("")
  const [rateLoading, setRateLoading] = useState(false)
  const [quote, setQuote] = useState<null | { expectedOutput: number; minOutput: number; midRate: number; expiresAt: string; lowLiquidity?: boolean }>(null)
  // Swap execution state
  type StatusUpdate = { status: string; message: string; txHash?: string }
  const STATUS_COLORS: Record<string, string> = {
    CONNECTING: 'text-muted-foreground',
    APPROVING: 'text-blue-400',
    APPROVED: 'text-blue-400',
    PREPARING: 'text-muted-foreground',
    PLACING_ORDER: 'text-blue-400',
    ORDER_PLACED: 'text-blue-400',
    AWAITING_BIDS: 'text-amber-400',
    BIDS_RECEIVED: 'text-amber-400',
    BID_SELECTED: 'text-orange-400',
    USEROP_SUBMITTED: 'text-orange-400',
    PARTIAL_FILL: 'text-orange-400',
    FILLED: 'text-emerald-400',
    FAILED: 'text-rose-400',
    PARTIAL_FILL_EXHAUSTED: 'text-rose-400',
  }
  const TERMINAL = new Set(['FILLED', 'FAILED', 'PARTIAL_FILL_EXHAUSTED'])
  const [swapLogs, setSwapLogs] = useState<StatusUpdate[]>([])
  const [swapping, setSwapping] = useState(false)
  const [swapDone, setSwapDone] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const shortAddress = useMemo(() => `${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}`, [walletAddress])
  const payUrl = payAlias ? `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/pay/${payAlias}` : null
  const qrUrl = payUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=6&data=${encodeURIComponent(payUrl)}`
    : null

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  async function startSwapInline() {
    if (!swapAmount || !quote) return
    setSwapping(true)
    setSwapDone(false)
    setSwapLogs([])
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/app/user/wallet/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromToken, toToken, amount: parseFloat(swapAmount), slippageBps: 100 }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text()
        setSwapLogs([{ status: 'FAILED', message: text || 'Swap request failed' }])
        setSwapDone(true)
        setSwapping(false)
        return
      }
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) { setSwapping(false); return }
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const update: StatusUpdate = JSON.parse(line.slice(6))
            setSwapLogs(prev => [...prev, update])
            if (TERMINAL.has(update.status)) {
              setSwapDone(true)
              setSwapping(false)
              if (update.status === 'FILLED') {
                window.dispatchEvent(new Event('swap:complete'))
              }
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      if ((err as any)?.name !== 'AbortError') {
        setSwapLogs(prev => [...prev, { status: 'FAILED', message: (err as Error)?.message || 'Network error' }])
      }
    } finally {
      setSwapping(false)
    }
  }

  function cancelSwapInline() {
    try { abortRef.current?.abort() } catch {}
    setSwapping(false)
  }

  function submitSend(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.set('to', to.trim())
    fd.set('amount', amount.trim())
    startTransition(async () => {
      const res = await sendNtzsAction(fd)
      setSendResult(res)
    })
  }

  async function fetchQuote(v: string, from: "NTZS" | "USDC", to: "NTZS" | "USDC") {
    if (!v || parseFloat(v) <= 0) { setQuote(null); return }
    setRateLoading(true)
    try {
      const res = await fetch(`/api/v1/swap/rate?from=${from}&to=${to}&amount=${encodeURIComponent(v)}`)
      if (res.ok) setQuote(await res.json())
      else setQuote(null)
    } catch {
      setQuote(null)
    } finally {
      setRateLoading(false)
    }
  }

  return (
    <div className="mt-6 space-y-4">
      {/* Inline info row */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background/35 px-2.5 py-1 backdrop-blur-xl">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Base
        </span>
        <button
          type="button"
          onClick={() => copy(walletAddress)}
          className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/35 px-3 py-1.5 font-mono text-foreground/85 backdrop-blur-xl hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring"
          title="Copy address"
        >
          {shortAddress}
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {copied && <span className="text-[10px] text-emerald-400">Copied</span>}
        </button>
      </div>

      {/* Tabs control */}
      <div className="inline-flex items-center rounded-full border border-border/40 bg-background/35 p-1 backdrop-blur-xl">
        {(["receive", "send", "swap"] as const).map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "relative rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition-colors",
              tab === key ? "text-foreground" : "text-muted-foreground hover:text-foreground/80",
            )}
          >
            {tab === key && (
              <span className="absolute inset-0 -z-10 rounded-full bg-foreground/10" />
            )}
            {key === "receive" ? "Receive" : key === "send" ? "Send" : "Swap"}
          </button>
        ))}
      </div>

      {/* Panels */}
      <div className="rounded-[24px] border border-border/40 bg-background/35 p-4 backdrop-blur-xl md:p-5">
        {tab === "receive" && (
          <div className="space-y-3">
            {payAlias ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm text-muted-foreground">Your link</div>
                  <div className="text-sm font-semibold text-foreground">@{payAlias}</div>
                </div>
                <div className="grid gap-3 md:grid-cols-[200px_1fr]">
                  {qrUrl && (
                    <div className="flex items-center justify-center rounded-2xl border border-border/40 bg-background/40 p-3">
                      <img src={qrUrl} alt="Pay QR" width={160} height={160} className="rounded" />
                    </div>
                  )}
                  <div className="space-y-3">
                    <div className="break-all rounded-xl border border-border/40 bg-background/30 p-3 text-xs text-muted-foreground">
                      {payUrl}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => payUrl && copy(payUrl)}
                        className="flex-1 rounded-2xl border border-border/40 bg-background/35 px-4 py-2.5 text-sm font-medium text-foreground backdrop-blur-xl transition-colors hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring"
                      >
                        Copy link
                      </button>
                      <a
                        href="#receive"
                        className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus:ring-2 focus:ring-ring"
                      >
                        Manage alias
                      </a>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">No alias yet <span className="ml-1 text-[11px]">(suggested: @{suggestedAlias})</span></div>
                <a
                  href="#receive"
                  className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground focus-visible:outline-none focus:ring-2 focus:ring-ring"
                >
                  Set up alias
                </a>
              </div>
            )}
          </div>
        )}

        {tab === "send" && (
          <div className="space-y-4">
            {sendResult?.success ? (
              <div className="space-y-2 rounded-2xl border border-border/40 bg-background/30 p-4 text-center">
                <p className="text-sm font-semibold text-foreground">Sent!</p>
                <p className="text-xs text-muted-foreground">
                  {sendResult.amountTzs.toLocaleString(undefined, { maximumFractionDigits: 4 })} nTZS sent.
                </p>
                <a
                  href={`${BASE_SCAN}${sendResult.mintTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border/40 bg-background/35 px-3 py-1.5 text-[11px] font-mono text-foreground/80 backdrop-blur-xl hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring"
                >
                  View on BaseScan
                </a>
              </div>
            ) : (
              <form onSubmit={submitSend} className="space-y-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted-foreground">To</label>
                  <input
                    type="text"
                    value={to}
                    onChange={(e) => { setTo(e.target.value); setSendResult(null) }}
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
                      onChange={(e) => { setAmount(e.target.value); setSendResult(null) }}
                      placeholder="0.00"
                      min="0.000001"
                      step="any"
                      required
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                    <span className="text-xs font-semibold text-muted-foreground">nTZS</span>
                  </div>
                </div>
                {sendResult && !sendResult.success && (
                  <p className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300 ring-1 ring-rose-500/20">{sendResult.error}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isPending || !to.trim() || !amount.trim()}
                    className="flex-1 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50 hover:opacity-90 focus-visible:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {isPending ? 'Sending…' : 'Send nTZS'}
                  </button>
                  <a href="#send" className="rounded-full border border-border/40 bg-background/35 px-4 py-3 text-sm font-medium text-foreground backdrop-blur-xl hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring">
                    Open full
                  </a>
                </div>
              </form>
            )}
          </div>
        )}

        {tab === "swap" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center rounded-full border border-border/40 bg-background/35 p-1 backdrop-blur-xl">
                {(["NTZS", "USDC"] as const).map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => { setFromToken(k); setQuote(null); setSwapAmount("") }}
                    className={cn(
                      "relative rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors",
                      fromToken === k ? "text-foreground" : "text-muted-foreground hover:text-foreground/80",
                    )}
                  >
                    {fromToken === k && <span className="absolute inset-0 -z-10 rounded-full bg-foreground/10" />}
                    {k === "NTZS" ? "nTZS" : "USDC"}
                  </button>
                ))}
              </div>
              <span className="text-sm text-muted-foreground">→</span>
              <span className="rounded-full border border-border/40 bg-background/35 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-foreground/90 backdrop-blur-xl">
                {toToken === "NTZS" ? "nTZS" : "USDC"}
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Amount</label>
              <input
                type="number"
                value={swapAmount}
                onChange={(e) => { const v = e.target.value; setSwapAmount(v); fetchQuote(v, fromToken, toToken) }}
                placeholder="0.00"
                min="0.000001"
                step="any"
                className="w-full rounded-2xl border border-border/40 bg-background/35 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="rounded-xl border border-border/40 bg-background/30 p-3 text-xs text-muted-foreground">
              {rateLoading ? (
                <span>Fetching rate…</span>
              ) : quote ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between"><span>Expected output</span><span className="font-medium text-foreground/90">{quote.expectedOutput.toLocaleString(undefined, { maximumFractionDigits: 4 })} {toToken === 'NTZS' ? 'nTZS' : 'USDC'}</span></div>
                  <div className="flex items-center justify-between"><span>Minimum received</span><span className="font-medium text-foreground/90">{quote.minOutput.toLocaleString(undefined, { maximumFractionDigits: 4 })} {toToken === 'NTZS' ? 'nTZS' : 'USDC'}</span></div>
                  <div className="flex items-center justify-between"><span>Rate</span><span className="font-medium text-foreground/90">{quote.midRate.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span></div>
                </div>
              ) : (
                <span>Enter an amount to preview your swap.</span>
              )}
            </div>

            {swapLogs.length > 0 && (
              <div className="rounded-xl border border-border/40 bg-background/30 p-3 text-xs">
                <div className="space-y-1">
                  {swapLogs.slice(-4).map((l, idx) => (
                    <div key={idx} className="flex items-center justify-between">
                      <span className={`font-medium ${STATUS_COLORS[l.status] || 'text-muted-foreground'}`}>{l.status.replaceAll('_', ' ')}</span>
                      <span className="text-muted-foreground/80 truncate max-w-[60%] text-right">{l.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={!quote || !swapAmount || swapping}
                onClick={startSwapInline}
                className="flex-1 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50 hover:opacity-90 focus-visible:outline-none focus:ring-2 focus:ring-ring"
              >
                {swapping ? 'Swapping…' : 'Start swap'}
              </button>
              {swapping ? (
                <button type="button" onClick={cancelSwapInline} className="rounded-full border border-border/40 bg-background/35 px-4 py-3 text-sm font-medium text-foreground backdrop-blur-xl hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring">
                  Cancel
                </button>
              ) : (
                <a href="#swap" className="rounded-full border border-border/40 bg-background/35 px-4 py-3 text-sm font-medium text-foreground backdrop-blur-xl hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring">
                  Open full
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
