'use client'

import { useCallback, useEffect, useState } from 'react'

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

function formatAmount(value: string, symbol: string): string {
  const n = parseFloat(value)
  if (symbol === 'USDC') return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function displaySymbol(sym: string): string {
  return sym === 'NTZS' ? 'nTZS' : sym
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

  useEffect(() => {
    fetchPage()
  }, [fetchPage])

  // Refresh after a swap completes
  useEffect(() => {
    const handler = () => {
      setSwaps([])
      setNextCursor(null)
      fetchPage()
    }
    window.addEventListener('swap:complete', handler)
    return () => window.removeEventListener('swap:complete', handler)
  }, [fetchPage])

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Swap history</p>
          <p className="mt-2 text-sm text-muted-foreground">Recent exchange activity from your wallet.</p>
        </div>
        <div className="flex justify-center rounded-[28px] border border-border/40 bg-background/30 p-8 backdrop-blur-xl">
          <svg className="h-5 w-5 animate-spin text-muted-foreground" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        </div>
      </div>
    )
  }

  if (swaps.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Swap history</p>
          <p className="mt-2 text-sm text-muted-foreground">Recent exchange activity from your wallet.</p>
        </div>
        <div className="rounded-[28px] border border-border/40 bg-background/30 p-8 text-center backdrop-blur-xl">
          <p className="text-sm text-muted-foreground">No swaps yet</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Swap history</p>
        <p className="mt-2 text-sm text-muted-foreground">Recent exchange activity from your wallet.</p>
      </div>

      <div className="relative">
        <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-2">
        {swaps.map((swap) => (
          <div key={swap.id} className="group flex items-center gap-4 rounded-[28px] border border-border/40 bg-background/35 p-5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-border/60">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-border/40 bg-background/70 text-foreground/70">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground/90">
                {formatAmount(swap.amountIn, swap.fromSymbol)} {displaySymbol(swap.fromSymbol)}
                <span className="mx-1.5 text-muted-foreground">&rarr;</span>
                {formatAmount(swap.amountOut, swap.toSymbol)} {displaySymbol(swap.toSymbol)}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">{formatDate(swap.createdAt)}</span>
                <a
                  href={`https://basescan.org/tx/${swap.outTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[10px] font-mono text-muted-foreground transition-colors hover:text-foreground/80"
                >
                  {swap.outTxHash.slice(0, 10)}...{swap.outTxHash.slice(-4)}
                </a>
              </div>
            </div>
          </div>
        ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-card/95 via-card/35 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card/95 via-card/35 to-transparent" />
      </div>

      {hasMore && (
        <div>
          <button
            type="button"
            onClick={() => fetchPage(nextCursor)}
            disabled={loadingMore}
            className="w-full rounded-full border border-border/40 bg-background/35 py-3 text-xs font-medium text-foreground/80 backdrop-blur-xl transition-colors hover:bg-background/45 disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
