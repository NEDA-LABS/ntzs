'use client'

import type React from 'react'
import { useRef, useState } from 'react'
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion'

import { TokenBalance } from './TokenBalance'
import { IconWallet } from '@/app/app/_components/icons'

interface DashboardHeroCardProps {
  payAlias: string | null
  email: string
  walletAddress: string | null
}

export function DashboardHeroCard({ payAlias, email, walletAddress }: DashboardHeroCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)
  const rotateX = useTransform(mouseY, [-60, 60], [5, -5])
  const rotateY = useTransform(mouseX, [-60, 60], [-5, 5])
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

  async function handleCopyAddress(e: React.MouseEvent) {
    e.stopPropagation()
    if (!walletAddress) return
    await navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const displayName = payAlias ? `@${payAlias}` : email

  return (
    <motion.div
      ref={containerRef}
      className="relative mb-3 cursor-pointer select-none"
      style={{ perspective: 1200 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onClick={() => setIsExpanded((v) => !v)}
    >
      <motion.div
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#12121e] to-[#0f0f1a] ring-1 ring-white/[0.06]"
        style={{
          rotateX: springRotateX,
          rotateY: springRotateY,
          transformStyle: 'preserve-3d',
        }}
        animate={{ height: isExpanded ? (walletAddress ? 160 : 120) : 88 }}
        transition={{ type: 'spring', stiffness: 350, damping: 32 }}
      >
        {/* Grid pattern */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:44px_44px]" />

        {/* Blue glow */}
        <div className="pointer-events-none absolute -top-16 right-0 h-48 w-64 rounded-full bg-blue-600/[0.07] blur-3xl" />

        {/* Hover shimmer */}
        <motion.div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_35%,rgba(255,255,255,0.03)_50%,transparent_65%)]"
          animate={{ opacity: isHovered ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        />

        <div className="relative z-10 flex h-full flex-col p-5">

          {/* Always-visible top row */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                Welcome back
              </p>
              <motion.h1
                className="font-bold text-white"
                animate={{ fontSize: isExpanded ? '1.1rem' : '1.25rem' }}
                transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              >
                {displayName}
              </motion.h1>
              {!isExpanded && (
                <p className="mt-0.5 text-xs text-zinc-500">Here is a summary of your account</p>
              )}
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-blue-600/15 px-3 py-2 ring-1 ring-blue-600/20">
              <IconWallet className="h-4 w-4 text-blue-400" />
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-wide text-blue-400">
                  Balance
                </p>
                {walletAddress ? (
                  <TokenBalance walletAddress={walletAddress} compact />
                ) : (
                  <p className="text-sm font-bold text-white">0 TZS</p>
                )}
              </div>
            </div>
          </div>

          {/* Expanded details */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                className="mt-4 space-y-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2, delay: 0.05 }}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
              >
                {walletAddress ? (
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-xs transition-all duration-150 active:scale-[0.99] ${
                      copied
                        ? 'bg-emerald-500/10 ring-1 ring-emerald-500/20 text-emerald-400'
                        : 'bg-white/[0.04] ring-1 ring-white/[0.06] text-zinc-400 hover:bg-white/[0.07]'
                    }`}
                  >
                    <span className="font-mono truncate max-w-[200px]">
                      {walletAddress}
                    </span>
                    {copied ? (
                      <svg className="h-3.5 w-3.5 shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="h-3.5 w-3.5 shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                ) : null}
                <div className="flex gap-2">
                  <span className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-medium text-zinc-500 ring-1 ring-white/[0.06]">
                    Base network
                  </span>
                  <span className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-medium text-zinc-500 ring-1 ring-white/[0.06]">
                    nTZS token
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Animated bottom underline */}
        <motion.div
          className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/30 to-transparent"
          animate={{ opacity: isHovered || isExpanded ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        />
      </motion.div>

      {/* Tap hint */}
      <motion.p
        className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-white/20"
        animate={{ opacity: isHovered && !isExpanded ? 1 : 0, y: isHovered ? 0 : 4 }}
        transition={{ duration: 0.2 }}
      >
        Tap for wallet details
      </motion.p>
    </motion.div>
  )
}
