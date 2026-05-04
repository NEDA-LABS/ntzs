'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, ArrowLeftRight, ExternalLink } from 'lucide-react'

interface Swap {
  id: string
  fromSymbol: string
  toSymbol: string
  amountIn: string
  amountOut: string
  inTxHash: string
  outTxHash: string
  createdAt: string
}

const TOKEN_COLORS: Record<string, string> = {
  NTZS: 'text-blue-300 bg-blue-400/10',
  USDC: 'text-emerald-300 bg-emerald-400/10',
  USDT: 'text-teal-300 bg-teal-400/10',
}

function tokenColor(sym: string) {
  return TOKEN_COLORS[sym.toUpperCase()] ?? 'text-foreground/70 bg-foreground/[0.06]'
}

function displaySymbol(sym: string): string {
  if (sym.toUpperCase() === 'NTZS') return 'nTZS'
  // If it still looks like an address, shorten it
  if (sym.startsWith('0x') && sym.length > 12) return `${sym.slice(0, 6)}…${sym.slice(-4)}`
  return sym
}

function formatAmount(value: string, symbol: string): string {
  const n = parseFloat(value)
  if (isNaN(n)) return value
  if (symbol.toUpperCase() === 'NTZS') {
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function SwapRow({ swap }: { swap: Swap }) {
  return (
    <div className="group flex items-center gap-4 rounded-2xl border border-border/40 bg-background/25 px-4 py-3.5 backdrop-blur-xl transition-all duration-200 hover:border-border/60 hover:bg-background/40">
      {/* Icon */}
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-border/40 bg-background/60 text-muted-foreground">
        <ArrowLeftRight className="h-3.5 w-3.5" />
      </div>

      {/* Token flow */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tokenColor(swap.fromSymbol)}`}>
            {formatAmount(swap.amountIn, swap.fromSymbol)} {displaySymbol(swap.fromSymbol)}
          </span>
          <ArrowRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" />
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tokenColor(swap.toSymbol)}`}>
            {formatAmount(swap.amountOut, swap.toSymbol)} {displaySymbol(swap.toSymbol)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span title={formatDate(swap.createdAt)}>{timeAgo(swap.createdAt)}</span>
          <span className="opacity-40">·</span>
          <a
            href={`https://basescan.org/tx/${swap.outTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-foreground/80"
            title={swap.outTxHash}
          >
            View tx <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border/40 bg-background/25 px-4 py-3.5">
      <div className="h-9 w-9 flex-shrink-0 rounded-full bg-foreground/[0.06] animate-pulse" />
      <div className="flex-1 space-y-2">
        <div className="h-5 w-48 rounded-full bg-foreground/[0.06] animate-pulse" />
        <div className="h-3 w-24 rounded-full bg-foreground/[0.04] animate-pulse" />
      </div>
    </div>
  )
}

export function SwapHistory() {
  const [swaps, setSwaps] = useState<Swap[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const fetchPage = useCallback(async (cursor?: string | null) => {
    const isFirst = !cursor
    if (isFirst) setLoading(true)
    else setLoadingMore(true)
    try {
      const url = cursor
        ? `/app/user/wallet/swap/history?cursor=${encodeURIComponent(cursor)}`
        : '/app/user/wallet/swap/history'
      const res = await fetch(url)
      if (!res.ok) return
      const data = await res.json()
      setSwaps((prev) => isFirst ? data.swaps : [...prev, ...data.swaps])
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
    } catch {
      // silent
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => { fetchPage() }, [fetchPage])

  useEffect(() => {
    const handler = () => { setSwaps([]); setNextCursor(null); fetchPage() }
    window.addEventListener('swap:complete', handler)
    return () => window.removeEventListener('swap:complete', handler)
  }, [fetchPage])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Swap History</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">Recent exchange activity</p>
        </div>
        {swaps.length > 0 && (
          <span className="rounded-full border border-border/40 bg-background/35 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {swaps.length}{hasMore ? '+' : ''}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2.5">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : swaps.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/40 py-10 text-center">
          <ArrowLeftRight className="mb-3 h-6 w-6 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground/70">No swaps yet</p>
          <p className="mt-1 text-xs text-muted-foreground/40">Exchange tokens to see activity here</p>
        </div>
      ) : (
        <div className="relative">
          <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-0.5">
            {swaps.map((swap) => (
              <SwapRow key={swap.id} swap={swap} />
            ))}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card/80 to-transparent" />
        </div>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={() => fetchPage(nextCursor)}
          disabled={loadingMore}
          className="w-full rounded-full border border-border/40 bg-background/35 py-2.5 text-xs font-medium text-muted-foreground backdrop-blur-xl transition-colors hover:bg-background/45 disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
