'use client'

import { motion, useReducedMotion } from 'framer-motion'

interface SupplyReconciliationCardProps {
  onChainSupply: number | null
  snippeBalance: number | null
  dbMintedViaSnippeOnly: number
  pendingMintsTzs: number
}

function generateDots(count: number, radius: number, cx: number, cy: number) {
  const dots = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI - Math.PI / 2
    const x = Math.round((cx + radius * Math.cos(angle)) * 100) / 100
    const y = Math.round((cy + radius * Math.sin(angle)) * 100) / 100
    dots.push({ x, y, delay: i * 0.015 })
  }
  return dots
}

export function SupplyReconciliationCard({
  onChainSupply,
  snippeBalance,
  dbMintedViaSnippeOnly,
  pendingMintsTzs,
}: SupplyReconciliationCardProps) {
  const shouldReduceMotion = useReducedMotion()

  const CX = 200
  const CY = 200
  const outerDots = generateDots(52, 178, CX, CY)
  const innerDots = generateDots(40, 148, CX, CY)

  const reserveHealth =
    onChainSupply && onChainSupply > 0 && snippeBalance !== null
      ? (snippeBalance / onChainSupply) * 100
      : null

  const healthColor =
    reserveHealth === null ? 'text-zinc-400' :
    reserveHealth >= 95 ? 'text-emerald-400' :
    reserveHealth >= 90 ? 'text-amber-400' :
    'text-rose-400'

  const healthLabel =
    reserveHealth === null ? 'Loading...' :
    reserveHealth >= 95 ? 'Healthy' :
    reserveHealth >= 90 ? 'Watch closely' :
    'Undercollateralized'

  const dotColor =
    reserveHealth === null ? '#22d3ee' :
    reserveHealth >= 95 ? '#22d3ee' :
    reserveHealth >= 90 ? '#f59e0b' :
    '#f43f5e'

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-zinc-900/60 overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-0 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Reserve Health</h2>
        <span className="text-[11px] font-medium text-zinc-600 uppercase tracking-wider">Base Mainnet · Snippe PSP</span>
      </div>

      {/* Dots + hero supply */}
      <div className="relative overflow-hidden" style={{ height: 320 }}>
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 400 400"
          preserveAspectRatio="xMidYMid meet"
        >
          {outerDots.map((dot, i) => (
            <motion.circle
              key={`o-${i}`}
              cx={dot.x}
              cy={dot.y}
              r={4.5}
              fill={dotColor}
              initial={shouldReduceMotion ? { opacity: 0.35 } : { opacity: 0, scale: 0 }}
              animate={{ opacity: 0.35, scale: 1 }}
              transition={{ delay: dot.delay, duration: 0.4, ease: 'easeOut' }}
            />
          ))}
          {innerDots.map((dot, i) => (
            <motion.circle
              key={`inn-${i}`}
              cx={dot.x}
              cy={dot.y}
              r={3.5}
              fill={dotColor}
              initial={shouldReduceMotion ? { opacity: 0.15 } : { opacity: 0, scale: 0 }}
              animate={{ opacity: 0.15, scale: 1 }}
              transition={{ delay: 0.2 + dot.delay, duration: 0.4, ease: 'easeOut' }}
            />
          ))}
        </svg>

        {/* Central text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ zIndex: 10 }}>
          <motion.p
            className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500 mb-2"
            initial={shouldReduceMotion ? {} : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            On-Chain Supply
          </motion.p>
          <motion.p
            className="text-6xl font-bold text-cyan-400 tabular-nums leading-none"
            initial={shouldReduceMotion ? {} : { opacity: 0, scale: 0.85, filter: 'blur(6px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ delay: 0.5, type: 'spring', stiffness: 280, damping: 26 }}
          >
            {onChainSupply !== null ? onChainSupply.toLocaleString() : '—'}
          </motion.p>
          <motion.p
            className="mt-3 text-xs text-zinc-600"
            initial={shouldReduceMotion ? {} : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.75 }}
          >
            nTZS in circulation
          </motion.p>
          {reserveHealth !== null && (
            <motion.div
              className={`mt-3 px-3 py-1 rounded-full border text-xs font-semibold tabular-nums ${
                reserveHealth >= 95
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : reserveHealth >= 90
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
              }`}
              initial={shouldReduceMotion ? {} : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.9 }}
            >
              {reserveHealth.toFixed(1)}% reserve
            </motion.div>
          )}
        </div>

        {/* Gradient fade — bottom half */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, transparent 30%, rgba(24,24,27,0.6) 55%, rgba(24,24,27,0.95) 72%, rgb(24,24,27) 85%)',
            zIndex: 6,
          }}
        />
      </div>

      {/* Secondary metric tickers */}
      <motion.div
        className="px-6 pb-5 -mt-2 relative grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4 sm:divide-x sm:divide-white/[0.05]"
        style={{ zIndex: 20 }}
        initial={shouldReduceMotion ? {} : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.4 }}
      >
        <div className="sm:pr-8">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Snippe Reserve</p>
          <p className="mt-1 text-sm font-bold text-emerald-400 tabular-nums">
            {snippeBalance !== null ? snippeBalance.toLocaleString() : '—'}
          </p>
          <p className="text-[10px] text-zinc-700">PSP collection balance</p>
        </div>
        <div className="sm:px-8">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Reserve Health</p>
          <p className={`mt-1 text-sm font-bold tabular-nums ${healthColor}`}>
            {reserveHealth !== null ? `${reserveHealth.toFixed(1)}%` : '—'}
          </p>
          <p className="text-[10px] text-zinc-700">{healthLabel}</p>
        </div>
        <div className="sm:px-8">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Minted via Snippe</p>
          <p className="mt-1 text-sm font-bold text-blue-400 tabular-nums">{dbMintedViaSnippeOnly.toLocaleString()}</p>
          <p className="text-[10px] text-zinc-700">Deposit flow</p>
        </div>
        <div className="sm:pl-8">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Pending Queue</p>
          <p className="mt-1 text-sm font-bold text-amber-400 tabular-nums">
            {pendingMintsTzs > 0 ? pendingMintsTzs.toLocaleString() : '—'}
          </p>
          <p className="text-[10px] text-zinc-700">Awaiting mint</p>
        </div>
      </motion.div>
    </div>
  )
}
