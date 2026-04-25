'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  ArrowLeftRight, ChevronRight, ArrowDownToLine, ArrowUpRight,
  Zap, ZapOff, AlertTriangle, CheckCircle2, Loader2,
} from 'lucide-react'
import { useLp } from '../layout'

interface PoolHealth {
  solver:   { ntzs: string; usdc: string }
  lp:       { effectiveNtzs: string; effectiveUsdc: string; ntzsSharePct: string; usdcSharePct: string }
  skew:     { ntzsSkewPct: string; usdcSkewPct: string; isNtzsLow: boolean; isUsdcLow: boolean; midRate: number }
  isActive: boolean
}

interface WalletBalance { ntzs: string; usdc: string }

type Step = 'overview' | 'deactivating' | 'adjust' | 'activating' | 'done'

function SkewBar({ ntzsPct, usdcPct, isNtzsLow, isUsdcLow }: {
  ntzsPct: number; usdcPct: number; isNtzsLow: boolean; isUsdcLow: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] uppercase tracking-widest text-zinc-500">
        <span className={isNtzsLow ? 'text-rose-400' : 'text-zinc-400'}>nTZS {ntzsPct.toFixed(1)}%</span>
        <span className={isUsdcLow ? 'text-rose-400' : 'text-zinc-400'}>USDC {usdcPct.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden flex">
        <div
          className={`h-full rounded-l-full transition-all duration-500 ${isNtzsLow ? 'bg-rose-500' : 'bg-blue-500'}`}
          style={{ width: `${ntzsPct}%` }}
        />
        <div
          className={`h-full rounded-r-full transition-all duration-500 ${isUsdcLow ? 'bg-rose-500' : 'bg-emerald-500'}`}
          style={{ width: `${usdcPct}%` }}
        />
      </div>
      <p className="text-[10px] text-zinc-600">Ideal range: 30–70% each side</p>
    </div>
  )
}

function StatRow({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.04] last:border-0">
      <span className="text-sm text-zinc-500">{label}</span>
      <div className="text-right">
        <p className={`text-sm font-mono tabular-nums ${warn ? 'text-rose-400' : 'text-white'}`}>{value}</p>
        {sub && <p className="text-[10px] text-zinc-600 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export default function RebalancePage() {
  const { lp, refresh } = useLp()
  const router = useRouter()

  const [health, setHealth]   = useState<PoolHealth | null>(null)
  const [wallet, setWallet]   = useState<WalletBalance | null>(null)
  const [step, setStep]       = useState<Step>('overview')
  const [error, setError]     = useState<string | null>(null)

  const fetchHealth = useCallback(() => {
    fetch('/simplefx/api/lp/pool-health')
      .then(r => r.json())
      .then(setHealth)
      .catch(() => {})
  }, [])

  const fetchWallet = useCallback(() => {
    fetch('/simplefx/api/lp/balances')
      .then(r => r.json())
      .then(d => setWallet({ ntzs: d.ntzs ?? '0', usdc: d.usdc ?? '0' }))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!lp) return
    fetchHealth()
  }, [lp, fetchHealth])

  useEffect(() => {
    if (step === 'adjust') fetchWallet()
  }, [step, fetchWallet])

  const deactivate = async () => {
    setStep('deactivating')
    setError(null)
    try {
      const res = await fetch('/simplefx/api/lp/activate', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Deactivation failed')
      await refresh()
      setStep('adjust')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Deactivation failed')
      setStep('overview')
    }
  }

  const activate = async () => {
    setStep('activating')
    setError(null)
    try {
      const res = await fetch('/simplefx/api/lp/activate', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Activation failed')
      await refresh()
      setStep('done')
      setTimeout(() => router.replace('/simplefx/dashboard'), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Activation failed')
      setStep('adjust')
    }
  }

  if (!lp) return null

  const isLow = health?.skew.isNtzsLow || health?.skew.isUsdcLow
  const fmt = (v: string | number | undefined) => {
    if (v === undefined || v === null) return '—'
    const n = parseFloat(v.toString())
    return isNaN(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  }

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Pool</p>
        <h1 className="text-3xl font-thin text-white mb-8">Rebalance</h1>

        <AnimatePresence mode="wait">

          {/* ── OVERVIEW ─────────────────────────────────────────── */}
          {step === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

              {/* Pool health card */}
              {health && (
                <div className={`rounded-2xl border p-6 mb-6 ${isLow ? 'border-rose-500/30 bg-rose-600/5' : 'border-white/5 bg-zinc-950'}`}>
                  <div className="flex items-center justify-between mb-5">
                    <p className="text-xs uppercase tracking-widest text-zinc-500">Solver Pool</p>
                    {isLow && (
                      <span className="flex items-center gap-1.5 text-xs text-rose-400">
                        <AlertTriangle size={13} /> Low liquidity
                      </span>
                    )}
                  </div>

                  <SkewBar
                    ntzsPct={parseFloat(health.skew.ntzsSkewPct)}
                    usdcPct={parseFloat(health.skew.usdcSkewPct)}
                    isNtzsLow={health.skew.isNtzsLow}
                    isUsdcLow={health.skew.isUsdcLow}
                  />

                  <div className="mt-5 space-y-0">
                    <StatRow
                      label="Pool nTZS"
                      value={fmt(health.solver.ntzs)}
                      sub="Total across all LPs"
                      warn={health.skew.isNtzsLow}
                    />
                    <StatRow
                      label="Pool USDC"
                      value={fmt(health.solver.usdc)}
                      sub="Total across all LPs"
                      warn={health.skew.isUsdcLow}
                    />
                    <StatRow
                      label="Your nTZS"
                      value={fmt(health.lp.effectiveNtzs)}
                      sub={`~${health.lp.ntzsSharePct}% of pool`}
                    />
                    <StatRow
                      label="Your USDC"
                      value={fmt(health.lp.effectiveUsdc)}
                      sub={`~${health.lp.usdcSharePct}% of pool`}
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-rose-500/20 bg-rose-600/5 px-4 py-3 text-sm text-rose-400 mb-4">
                  {error}
                </div>
              )}

              {/* What rebalancing does */}
              <div className="rounded-2xl border border-white/5 bg-zinc-950 p-6 mb-6">
                <p className="text-sm font-medium text-white mb-3">How it works</p>
                <div className="space-y-3">
                  {[
                    { icon: ZapOff,         label: 'Deactivate',   desc: 'Your tokens return to your LP wallet' },
                    { icon: ArrowLeftRight, label: 'Adjust',       desc: 'Deposit more or withdraw the excess side' },
                    { icon: Zap,            label: 'Reactivate',   desc: 'Go live again with your rebalanced inventory' },
                  ].map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center flex-none mt-0.5">
                        <Icon size={13} className="text-zinc-400" />
                      </div>
                      <div>
                        <p className="text-sm text-white">{label}</p>
                        <p className="text-xs text-zinc-600">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {lp.isActive ? (
                <button
                  onClick={deactivate}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                >
                  <ZapOff size={15} /> Start — Deactivate position
                </button>
              ) : (
                // LP is already inactive — skip to adjust step
                <button
                  onClick={() => setStep('adjust')}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                >
                  <ArrowLeftRight size={15} /> Adjust inventory
                </button>
              )}
            </motion.div>
          )}

          {/* ── DEACTIVATING ─────────────────────────────────────── */}
          {step === 'deactivating' && (
            <motion.div key="deactivating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="rounded-2xl border border-white/5 bg-zinc-950 p-12 flex flex-col items-center text-center"
            >
              <Loader2 size={28} className="text-blue-400 animate-spin mb-4" />
              <p className="text-white text-sm font-medium mb-1">Returning tokens to your wallet</p>
              <p className="text-zinc-600 text-xs max-w-xs">Waiting for the on-chain transfer to confirm…</p>
            </motion.div>
          )}

          {/* ── ADJUST ───────────────────────────────────────────── */}
          {step === 'adjust' && (
            <motion.div key="adjust" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="rounded-2xl border border-white/5 bg-zinc-950 p-6 mb-6">
                <p className="text-xs uppercase tracking-widest text-zinc-500 mb-4">Your wallet now</p>
                {wallet ? (
                  <div>
                    <StatRow label="nTZS" value={fmt(wallet.ntzs)} />
                    <StatRow label="USDC" value={fmt(wallet.usdc)} />
                  </div>
                ) : (
                  <div className="h-16 rounded-lg bg-zinc-900 animate-pulse" />
                )}
              </div>

              <div className="rounded-2xl border border-white/5 bg-zinc-950 p-6 mb-6">
                <p className="text-sm font-medium text-white mb-1">Adjust your inventory</p>
                <p className="text-xs text-zinc-500 mb-5">
                  Add more of the low side or withdraw excess from the heavy side before reactivating.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Link
                    href="/simplefx/dashboard/deposit"
                    className="flex items-center gap-2 px-4 py-3 rounded-xl border border-white/5 hover:border-blue-500/30 hover:bg-blue-600/5 transition-all text-sm text-zinc-400 hover:text-white"
                  >
                    <ArrowDownToLine size={14} className="text-blue-400" />
                    Deposit
                  </Link>
                  <Link
                    href="/simplefx/dashboard/withdraw"
                    className="flex items-center gap-2 px-4 py-3 rounded-xl border border-white/5 hover:border-blue-500/30 hover:bg-blue-600/5 transition-all text-sm text-zinc-400 hover:text-white"
                  >
                    <ArrowUpRight size={14} className="text-blue-400" />
                    Withdraw
                  </Link>
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-rose-500/20 bg-rose-600/5 px-4 py-3 text-sm text-rose-400 mb-4">
                  {error}
                </div>
              )}

              <button
                onClick={activate}
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
              >
                <Zap size={15} /> Reactivate — Go live
              </button>
              <p className="text-center text-xs text-zinc-600 mt-3">
                All tokens in your wallet will be swept into the pool
              </p>
            </motion.div>
          )}

          {/* ── ACTIVATING ───────────────────────────────────────── */}
          {step === 'activating' && (
            <motion.div key="activating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="rounded-2xl border border-white/5 bg-zinc-950 p-12 flex flex-col items-center text-center"
            >
              <Loader2 size={28} className="text-blue-400 animate-spin mb-4" />
              <p className="text-white text-sm font-medium mb-1">Sweeping tokens into pool</p>
              <p className="text-zinc-600 text-xs max-w-xs">Waiting for the activation transaction to confirm…</p>
            </motion.div>
          )}

          {/* ── DONE ─────────────────────────────────────────────── */}
          {step === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="rounded-2xl border border-blue-500/20 bg-blue-600/5 p-12 flex flex-col items-center text-center"
            >
              <CheckCircle2 size={32} className="text-blue-400 mb-4" />
              <p className="text-white text-sm font-medium mb-1">Pool rebalanced</p>
              <p className="text-zinc-500 text-xs">Returning to overview…</p>
            </motion.div>
          )}

        </AnimatePresence>

        {(step === 'overview' || step === 'adjust') && (
          <Link href="/simplefx/dashboard" className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors mt-6">
            ← Back to overview
          </Link>
        )}
      </motion.div>
    </div>
  )
}
