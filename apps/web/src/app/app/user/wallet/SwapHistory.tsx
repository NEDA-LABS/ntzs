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
      <div className="rounded-2xl border border-white/[0.06] bg-[#12121e] p-5 ring-1 ring-white/[0.06]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Swap history</p>
        <div className="mt-4 flex justify-center">
          <svg className="h-5 w-5 animate-spin text-zinc-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        </div>
      </div>
    )
  }

  if (swaps.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-[#12121e] p-5 ring-1 ring-white/[0.06]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Swap history</p>
        <p className="mt-3 text-center text-xs text-zinc-600">No swaps yet</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#12121e] ring-1 ring-white/[0.06] overflow-hidden">
      <div className="px-5 pt-5 pb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Swap history</p>
      </div>

      <div className="divide-y divide-white/[0.04]">
        {swaps.map((swap) => (
          <div key={swap.id} className="px-5 py-3.5 flex items-center gap-3">
            {/* Icon */}
            <div className="flex-none flex h-8 w-8 items-center justify-center rounded-full bg-blue-600/10 ring-1 ring-blue-500/20">
              <svg className="h-3.5 w-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">
                {formatAmount(swap.amountIn, swap.fromSymbol)} {displaySymbol(swap.fromSymbol)}
                <span className="text-zinc-600 mx-1.5">&rarr;</span>
                {formatAmount(swap.amountOut, swap.toSymbol)} {displaySymbol(swap.toSymbol)}
              </p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-[11px] text-zinc-600">{formatDate(swap.createdAt)}</span>
                <a
                  href={`https://basescan.org/tx/${swap.outTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono text-zinc-700 hover:text-blue-400 transition-colors truncate"
                >
                  {swap.outTxHash.slice(0, 10)}...{swap.outTxHash.slice(-4)}
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="px-5 py-3 border-t border-white/[0.04]">
          <button
            type="button"
            onClick={() => fetchPage(nextCursor)}
            disabled={loadingMore}
            className="w-full rounded-xl bg-white/[0.03] py-2.5 text-xs font-medium text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300 transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
