'use client'

import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Link2 } from 'lucide-react'
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

function StatusBadge({ status, type }: { status: string; type: Txn['type'] }) {
  const s = status.toLowerCase().replace(/_/g, ' ')
  const color =
    type === 'swap'
      ? 'bg-violet-500/12 text-violet-400'
      : type === 'send'
      ? 'bg-blue-500/12 text-blue-400'
      : type === 'deposit'
        ? s === 'minted' ? 'bg-emerald-500/12 text-emerald-400'
          : s === 'rejected' || s === 'cancelled' ? 'bg-rose-500/12 text-rose-400'
          : 'bg-amber-500/12 text-amber-400'
        : s === 'burned' ? 'bg-rose-500/12 text-rose-300'
          : s === 'failed' ? 'bg-rose-500/12 text-rose-400'
          : 'bg-amber-500/12 text-amber-400'

  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium capitalize', color)}>
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
    <div className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur-2xl overflow-hidden">
      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b border-border/40 px-4 py-3">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filter === f
                ? 'bg-primary/10 text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? 'transaction' : 'transactions'}
        </span>
      </div>

      {/* List */}
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
            const label = isSwap
              ? `Swap · ${t.fromSymbol} → ${t.toSymbol}`
              : isSend
              ? `Send · ${t.toAddress ? `${t.toAddress.slice(0, 6)}…${t.toAddress.slice(-4)}` : ''}`
              : isDeposit
                ? isCollection
                  ? t.payerName ? `Collection · ${t.payerName}` : 'Collection'
                  : 'Deposit'
                : 'Withdrawal'

            const iconBg = isSwap ? 'bg-violet-500/12' : isSend ? 'bg-blue-500/12' : isDeposit ? (isCollection ? 'bg-blue-500/12' : 'bg-emerald-500/12') : 'bg-rose-500/12'
            const amountColor = isSwap ? 'text-violet-400' : isSend ? 'text-blue-400' : isDeposit ? 'text-emerald-400' : 'text-rose-300'
            const amountPrefix = isDeposit ? '+' : isSwap ? '' : '-'

            return (
              <div
                key={t.id}
                className="flex items-center justify-between px-4 py-4 transition-colors hover:bg-card/40"
              >
                <div className="flex items-center gap-3.5">
                  <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', iconBg)}>
                    {isSwap ? (
                      <ArrowLeftRight className="h-4 w-4 text-violet-400" />
                    ) : isSend ? (
                      <ArrowUpRight className="h-4 w-4 text-blue-400" />
                    ) : isDeposit ? (
                      isCollection ? <Link2 className="h-4 w-4 text-blue-400" /> : <ArrowDownLeft className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4 text-rose-300" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.formattedDate}</p>
                  </div>
                </div>

                <div className="text-right">
                  {isSwap ? (
                    <p className={cn('text-sm font-semibold font-mono', amountColor)}>
                      {parseFloat(t.amountIn || '0').toLocaleString(undefined, { maximumFractionDigits: 2 })} {t.fromSymbol} → {parseFloat(t.amountOut || '0').toLocaleString(undefined, { maximumFractionDigits: 2 })} {t.toSymbol}
                    </p>
                  ) : (
                    <p className={cn('text-sm font-semibold font-mono', amountColor)}>
                      {amountPrefix}{t.amountTzs.toLocaleString()} TZS
                    </p>
                  )}
                  <div className="mt-1 flex justify-end">
                    <StatusBadge status={t.status} type={t.type} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
