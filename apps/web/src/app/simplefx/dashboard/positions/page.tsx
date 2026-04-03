'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Activity } from 'lucide-react'
import { useLp } from '../layout'

interface Fill {
  id: string
  userAddress: string
  fromToken: string
  toToken: string
  amountIn: string
  amountOut: string
  spreadEarned: string
  inTxHash: string
  outTxHash: string
  createdAt: string
}

const NTZS = '0xf476ba983de2f1ad532380630e2cf1d1b8b10688'
const USDC  = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

function tokenSymbol(addr: string) {
  return addr.toLowerCase() === NTZS ? 'nTZS' : addr.toLowerCase() === USDC ? 'USDC' : addr.slice(0, 6)
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

export default function PositionsPage() {
  const { lp } = useLp()
  const [fills, setFills] = useState<Fill[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!lp) return
    fetch('/simplefx/api/lp/fills')
      .then(r => r.json())
      .then(d => setFills(d.fills ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [lp])

  if (!lp) return null

  const totalSpread = fills.reduce((sum, f) => sum + parseFloat(f.spreadEarned || '0'), 0)

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Positions</p>
        <h1 className="text-3xl font-thin text-white mb-2">Order fills</h1>

        {fills.length > 0 && (
          <p className="text-zinc-500 text-sm mb-8">
            Total spread earned: <span className="text-emerald-400 font-semibold">{totalSpread.toFixed(6)}</span>
          </p>
        )}

        {loading ? (
          <div className="rounded-2xl border border-white/5 bg-zinc-950 p-8 space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-zinc-900 animate-pulse" />
            ))}
          </div>
        ) : fills.length === 0 ? (
          <div className="rounded-2xl border border-white/5 bg-zinc-950 p-16 flex flex-col items-center justify-center text-center mt-8">
            <div className="w-12 h-12 rounded-xl bg-zinc-900 flex items-center justify-center mb-4">
              <Activity size={20} className="text-zinc-600" />
            </div>
            <p className="text-zinc-400 text-sm font-medium mb-1">No fills yet</p>
            <p className="text-zinc-600 text-xs max-w-xs leading-relaxed">
              Once your position is live and inventory is funded, filled orders will appear here in real time.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/5 bg-zinc-950 overflow-hidden mt-8">
            <div className="grid grid-cols-6 px-4 py-2 text-[10px] uppercase tracking-widest text-zinc-600 border-b border-white/5">
              <span>Time</span>
              <span>User</span>
              <span>Pair</span>
              <span>Amount in</span>
              <span>Amount out</span>
              <span>Spread earned</span>
            </div>
            {fills.map((fill) => {
              const fromSym = tokenSymbol(fill.fromToken)
              const toSym = tokenSymbol(fill.toToken)
              const date = new Date(fill.createdAt)
              return (
                <div
                  key={fill.id}
                  className="grid grid-cols-6 px-4 py-3 text-xs text-zinc-300 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  <span className="text-zinc-500">
                    {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-zinc-400 font-mono">{shortAddr(fill.userAddress)}</span>
                  <span className="font-medium">{fromSym} → {toSym}</span>
                  <span>{parseFloat(fill.amountIn).toLocaleString(undefined, { maximumFractionDigits: 4 })} {fromSym}</span>
                  <span>
                    <a
                      href={`https://basescan.org/tx/${fill.outTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline font-mono"
                    >
                      {shortHash(fill.outTxHash)}
                    </a>
                    {' '}· {parseFloat(fill.amountOut).toLocaleString(undefined, { maximumFractionDigits: 6 })} {toSym}
                  </span>
                  <span className="text-emerald-400">
                    +{parseFloat(fill.spreadEarned).toFixed(6)} {toSym}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </motion.div>
    </div>
  )
}
