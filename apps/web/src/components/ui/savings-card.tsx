"use client"

import type React from "react"
import { useRef, useState } from "react"
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion"

export interface SavingsProduct {
  id: string
  name: string
  description: string | null
  annualRateBps: number
  lockDays: number
  minDepositTzs: number
}

export interface SavingsPosition {
  principalTzs: number
  accruedYieldTzs: number
  totalDepositedTzs: number
  openedAt: string
}

interface SavingsCardProps {
  product: SavingsProduct
  position: SavingsPosition | null
  className?: string
  onSaveTap?: () => void
}

export function SavingsCard({ product, position, className, onSaveTap }: SavingsCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const ratePercent = product.annualRateBps / 100
  const hasFunds = !!position && position.principalTzs > 0

  const dailyYield = hasFunds
    ? Math.floor((position!.principalTzs * product.annualRateBps) / 10_000 / 365)
    : 0

  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  const rotateX = useTransform(mouseY, [-60, 60], [6, -6])
  const rotateY = useTransform(mouseX, [-60, 60], [-6, 6])

  const springRotateX = useSpring(rotateX, { stiffness: 300, damping: 30 })
  const springRotateY = useSpring(rotateY, { stiffness: 300, damping: 30 })

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    mouseX.set(e.clientX - (rect.left + rect.width / 2))
    mouseY.set(e.clientY - (rect.top + rect.height / 2))
  }

  const handleMouseLeave = () => {
    mouseX.set(0)
    mouseY.set(0)
    setIsHovered(false)
  }

  return (
    <motion.div
      ref={containerRef}
      className={`relative cursor-pointer select-none ${className ?? ""}`}
      style={{ perspective: 1200 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onClick={() => setIsExpanded((v) => !v)}
    >
      <motion.div
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl"
        style={{
          rotateX: springRotateX,
          rotateY: springRotateY,
          transformStyle: "preserve-3d",
        }}
        animate={{ height: isExpanded ? (hasFunds ? 360 : 300) : 210 }}
        transition={{ type: "spring", stiffness: 350, damping: 32 }}
      >
        {/* Background radial gradients */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(139,92,246,0.20),transparent_50%),radial-gradient(circle_at_85%_100%,rgba(16,185,129,0.14),transparent_55%)]" />

        {/* Hover shimmer */}
        <motion.div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_35%,rgba(255,255,255,0.04)_50%,transparent_65%)]"
          animate={{ opacity: isHovered ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        />

        {/* Card content */}
        <div className="relative z-10 flex h-full flex-col p-6">

          {/* Header row */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-400/80">
              Savings
            </span>
            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-[10px] font-medium uppercase tracking-widest text-white/40">
                Live
              </span>
            </div>
          </div>

          {/* Rate block */}
          <motion.div
            className="mt-auto"
            animate={{ y: isExpanded ? -4 : 0 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
          >
            <div className="flex items-end gap-2">
              <motion.span
                className="font-bold leading-none text-white"
                animate={{ fontSize: isExpanded ? "2.25rem" : "3.75rem" }}
                transition={{ type: "spring", stiffness: 350, damping: 30 }}
              >
                {ratePercent}%
              </motion.span>
              <span
                className="mb-1.5 text-sm font-medium text-white/40"
                style={{ fontSize: isExpanded ? "0.75rem" : "0.875rem" }}
              >
                p.a.
              </span>
            </div>

            <div className="mt-1 text-sm text-white/35">{product.name}</div>

            {/* Animated underline */}
            <motion.div
              className="mt-3 h-px bg-gradient-to-r from-violet-500/60 via-emerald-400/30 to-transparent"
              animate={{
                scaleX: isHovered || isExpanded ? 1 : 0.2,
                originX: 0,
              }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </motion.div>

          {/* Expanded panel */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                className="mt-5 space-y-3"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.22, delay: 0.04 }}
              >
                {hasFunds ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-2xl border border-white/5 bg-white/[0.04] p-4">
                        <div className="text-[11px] text-white/40">Saved</div>
                        <div className="mt-1 text-base font-semibold text-white">
                          {position!.principalTzs.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-white/25">TZS</div>
                      </div>
                      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
                        <div className="text-[11px] text-emerald-400/70">Earned</div>
                        <div className="mt-1 text-base font-semibold text-emerald-400">
                          +{position!.accruedYieldTzs.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-emerald-400/35">TZS yield</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-2.5 text-xs">
                      <span className="text-white/40">Today&apos;s yield</span>
                      <span className="font-mono text-emerald-400">
                        +{dailyYield.toLocaleString()} TZS
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-4 text-center">
                    <div className="text-sm text-white/50">
                      Earn {ratePercent}% annually. Withdraw any time.
                    </div>
                    {product.minDepositTzs > 0 && (
                      <div className="mt-1.5 text-xs text-white/25">
                        Minimum: {product.minDepositTzs.toLocaleString()} TZS
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSaveTap?.() }}
                  className="block w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 py-3.5 text-center text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 hover:shadow-blue-500/40 active:scale-[0.98]"
                >
                  {hasFunds ? "Add Funds" : "Start Saving"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Tap hint */}
      <motion.p
        className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-white/25"
        animate={{
          opacity: isHovered && !isExpanded ? 1 : 0,
          y: isHovered ? 0 : 4,
        }}
        transition={{ duration: 0.2 }}
      >
        Tap to see details
      </motion.p>
    </motion.div>
  )
}
