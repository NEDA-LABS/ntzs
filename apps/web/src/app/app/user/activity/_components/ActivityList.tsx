'use client'

import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Link2, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Txn {
  id: string
  type: 'deposit' | 'burn' | 'send' | 'swap'
  source?: string
  payerName?: string
  toAddress?: string
  mintTxHash?: string
  amountTzs: number
  status: string
  formattedDate: string
  // swap-specific
  fromSymbol?: string
  toSymbol?: string
  amountIn?: string
  amountOut?: string
}

const FILTERS = ['All', 'Deposits', 'Sent', 'Swaps', 'Withdrawals'] as const
type Filter = (typeof FILTERS)[number]

const BASESCAN = 'https://basescan.org/tx/'

/** Shorten a hex address or return the symbol as-is */
function shortToken(raw?: string): string {
  if (!raw) return '—'
  if (/^0x[0-9a-fA-F]{10,}$/.test(raw)) {
    return `${raw.slice(0, 6)}…${raw.slice(-4)}`
  }
  return raw.toUpperCase()
}

/** Make amount readable — strip trailing zeros */
function fmt(val?: string, decimals = 4) {
  const n = parseFloat(val || '0')
  if (!n) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals })
}

function StatusBadge({ status, type }: { status: string; type: Txn['type'] }) {
  const s = status.toLowerCase().replace(/_/g, ' ')
  const color =
    type === 'swap'
      ? 'bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/20'
      : type === 'send'
      ? 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/20'
      : type === 'deposit'
        ? s === 'minted'
          ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20'
          : s === 'rejected' || s === 'cancelled'
          ? 'bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/20'
          : 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20'
        : s === 'burned'
        ? 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/20'
        : s === 'failed'
        ? 'bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/20'
        : 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20'

  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize tracking-wide', color)}>
      {s}
    </span>
  )
}

export function ActivityList({ txns }: { txns: Txn[] }) {
  const [filter, setFilter] = useState<Filter>('All')

  const filtered = txns.filter((t) => {
    if (filter === 'Deposits') return t.type === 'deposit'
    if (filter === 'Withdrawals') return t.type === 'burn'
    if (filter === 'Sent') return t.type === 'send'
    if (filter === 'Swaps') return t.type === 'swap'
    return true
  })

  return (
    <div className="space-y-3">
      {/* Filter pill row */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-all',
              filter === f
                ? 'bg-foreground text-background shadow-sm'
                : 'border border-border/40 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-card/80 backdrop-blur-xl',
            )}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground whitespace-nowrap pl-2">
          {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
        </span>
      </div>

      {/* List card */}
      <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/60 backdrop-blur-2xl">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">No transactions found</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {filtered.map((t) => {
              const isSwap = t.type === 'swap'
              const isSend = t.type === 'send'
              const isDeposit = t.type === 'deposit'
              const isCollection = t.source === 'pay_link'

              /* ── Icon colours ── */
              const iconBg = isSwap
                ? 'bg-violet-500/12'
                : isSend
                ? 'bg-blue-500/12'
                : isDeposit
                ? isCollection ? 'bg-blue-500/12' : 'bg-emerald-500/12'
                : 'bg-rose-500/12'

              const amountColor = isSwap
                ? 'text-violet-400'
                : isSend
                ? 'text-blue-400'
                : isDeposit
                ? 'text-emerald-400'
                : 'text-rose-300'

              /* ── Swap token labels (handles raw addresses gracefully) ── */
              const fromLabel = shortToken(t.fromSymbol)
              const toLabel = shortToken(t.toSymbol)

              /* ── Primary row label ── */
              const label = isSwap
                ? 'Swap'
                : isSend
                ? 'Send'
                : isDeposit
                ? isCollection
                  ? t.payerName ? `Collection · ${t.payerName}` : 'Collection'
                  : 'Deposit'
                : 'Withdrawal'

              /* ── Secondary detail line ── */
              const detail = isSwap
                ? `${fromLabel} → ${toLabel}`
                : isSend && t.toAddress
                ? `${t.toAddress.slice(0, 8)}…${t.toAddress.slice(-6)}`
                : null

              const amountPrefix = isDeposit ? '+' : isSwap ? '' : '-'
              const txHash = t.mintTxHash

              return (
                <div
                  key={t.id}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]"
                >
                  {/* Icon */}
                  <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', iconBg)}>
                    {isSwap ? (
                      <ArrowLeftRight className="h-4 w-4 text-violet-400" />
                    ) : isSend ? (
                      <ArrowUpRight className="h-4 w-4 text-blue-400" />
                    ) : isDeposit ? (
                      isCollection
                        ? <Link2 className="h-4 w-4 text-blue-400" />
                        : <ArrowDownLeft className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4 text-rose-300" />
                    )}
                  </div>

                  {/* Label + detail + date */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    {detail && (
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{detail}</p>
                    )}
                    <p className="mt-0.5 text-[11px] text-muted-foreground/60">{t.formattedDate}</p>
                  </div>

                  {/* Amount + status + hash link */}
                  <div className="shrink-0 text-right">
                    {isSwap ? (
                      <p className={cn('text-sm font-semibold font-mono', amountColor)}>
                        {fmt(t.amountIn)} → {fmt(t.amountOut)}
                      </p>
                    ) : (
                      <p className={cn('text-sm font-semibold font-mono', amountColor)}>
                        {amountPrefix}{t.amountTzs.toLocaleString()} TZS
                      </p>
                    )}

                    <div className="mt-1.5 flex items-center justify-end gap-2">
                      <StatusBadge status={t.status} type={t.type} />
                      {txHash && (
                        <a
                          href={`${BASESCAN}${txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View on BaseScan"
                          className="text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
