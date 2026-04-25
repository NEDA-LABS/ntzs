'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowDownToLine, ArrowUpRight, Zap, ZapOff, Smartphone, ExternalLink, type LucideIcon } from 'lucide-react'
import { useLp } from '../layout'

interface WalletTx {
  id: string
  type: 'deposit' | 'withdrawal' | 'activation_sweep' | 'deactivation_return'
  source: 'mpesa' | 'onchain' | 'system'
  tokenAddress: string
  tokenSymbol: string
  decimals: number
  amount: string
  txHash: string | null
  createdAt: string
}

const TYPE_META: Record<WalletTx['type'], { label: string; Icon: LucideIcon; color: string }> = {
  deposit:             { label: 'Deposit',           Icon: ArrowDownToLine, color: 'text-emerald-400' },
  withdrawal:          { label: 'Withdrawal',        Icon: ArrowUpRight,    color: 'text-rose-400'    },
  activation_sweep:    { label: 'Pool deposit',      Icon: Zap,             color: 'text-blue-400'    },
  deactivation_return: { label: 'Pool withdrawal',   Icon: ZapOff,          color: 'text-amber-400'   },
}

function TxRow({ tx }: { tx: WalletTx }) {
  const meta = TYPE_META[tx.type]
  const Icon = meta.Icon
  const amount = parseFloat(tx.amount)
  const isCredit = tx.type === 'deposit' || tx.type === 'deactivation_return'
  const date = new Date(tx.createdAt)

  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-5 py-4 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
      {/* Icon */}
      <div className={`w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center flex-none ${meta.color}`}>
        <Icon size={15} />
      </div>

      {/* Type + source + date */}
      <div className="min-w-0">
        <p className="text-sm text-white font-medium">{meta.label}</p>
        <p className="text-xs text-zinc-600 mt-0.5">
          {tx.source === 'mpesa' && <><Smartphone size={10} className="inline mr-1" />M-Pesa · </>}
          {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      {/* Amount */}
      <div className="text-right">
        <p className={`text-sm font-mono tabular-nums ${isCredit ? 'text-emerald-400' : 'text-zinc-300'}`}>
          {isCredit ? '+' : '-'}{amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </p>
        <p className="text-xs text-zinc-600 mt-0.5">{tx.tokenSymbol}</p>
      </div>

      {/* Tx hash link */}
      <div className="flex-none w-8 text-right">
        {tx.txHash ? (
          <a
            href={`https://basescan.org/tx/${tx.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-600 hover:text-blue-400 transition-colors"
            title={tx.txHash}
          >
            <ExternalLink size={13} />
          </a>
        ) : (
          <span className="text-zinc-800 text-xs">—</span>
        )}
      </div>
    </div>
  )
}

export default function TransactionsPage() {
  const { lp } = useLp()
  const [txs, setTxs] = useState<WalletTx[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!lp) return
    fetch('/simplefx/api/lp/transactions')
      .then(r => r.json())
      .then(d => setTxs(d.transactions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [lp])

  if (!lp) return null

  // Per-token summaries
  const summary: Record<string, { in: number; out: number }> = {}
  for (const tx of txs) {
    const sym = tx.tokenSymbol
    if (!summary[sym]) summary[sym] = { in: 0, out: 0 }
    const amt = parseFloat(tx.amount)
    if (tx.type === 'deposit' || tx.type === 'deactivation_return') {
      summary[sym].in += amt
    } else {
      summary[sym].out += amt
    }
  }

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Transactions</p>
        <h1 className="text-3xl font-thin text-white mb-8">Wallet history</h1>

        {/* Summary cards */}
        {!loading && txs.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {Object.entries(summary).flatMap(([sym, { in: inAmt, out }]) => [
              <div key={`${sym}-in`} className="rounded-xl border border-white/5 bg-zinc-950 p-4">
                <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Total {sym} in</p>
                <p className="text-lg font-light text-emerald-400 tabular-nums">
                  +{inAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
              </div>,
              <div key={`${sym}-out`} className="rounded-xl border border-white/5 bg-zinc-950 p-4">
                <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Total {sym} out</p>
                <p className="text-lg font-light text-zinc-300 tabular-nums">
                  -{out.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
              </div>,
            ])}
          </div>
        )}

        {/* Transaction list */}
        {loading ? (
          <div className="rounded-2xl border border-white/5 bg-zinc-950 p-8 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-zinc-900 animate-pulse" />
            ))}
          </div>
        ) : txs.length === 0 ? (
          <div className="rounded-2xl border border-white/5 bg-zinc-950 p-16 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-xl bg-zinc-900 flex items-center justify-center mb-4">
              <ArrowDownToLine size={20} className="text-zinc-600" />
            </div>
            <p className="text-zinc-400 text-sm font-medium mb-1">No transactions yet</p>
            <p className="text-zinc-600 text-xs max-w-xs leading-relaxed">
              Deposits, withdrawals, and pool activity will appear here as they happen.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/5 bg-zinc-950 overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[auto_1fr_auto_auto] gap-4 px-5 py-2.5 text-[10px] uppercase tracking-widest text-zinc-600 border-b border-white/5">
              <div className="w-8" />
              <span>Activity</span>
              <span className="text-right">Amount</span>
              <div className="w-8" />
            </div>
            {txs.map(tx => <TxRow key={tx.id} tx={tx} />)}
          </div>
        )}
      </motion.div>
    </div>
  )
}
