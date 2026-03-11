'use client'

import type React from 'react'
import { useRef, useState } from 'react'
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion'

import { TokenBalance } from './TokenBalance'

interface DashboardHeroCardProps {
  payAlias: string | null
  email: string
  walletAddress: string | null
}

export function DashboardHeroCard({ payAlias, email, walletAddress }: DashboardHeroCardProps) {
  const [isHovered, setIsHovered] = useState(false)
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

  const displayName = payAlias ? `@${payAlias}` : email

  return (
    <motion.div
      ref={containerRef}
      className="relative mb-3 select-none"
      style={{ perspective: 1200 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#12121e] to-[#0f0f1a] px-6 pb-6 pt-5 ring-1 ring-white/[0.06]"
        style={{
          rotateX: springRotateX,
          rotateY: springRotateY,
          transformStyle: 'preserve-3d',
        }}
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

        <div className="relative z-10">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
            Welcome back
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">{displayName}</h1>
          <p className="mt-0.5 text-xs text-zinc-500">Here is a summary of your account</p>

          {/* Balance row — dots when resting, number on hover */}
          <div className="relative mt-5 h-10">
            {/* Hidden state: masked dots */}
            <motion.div
              className="absolute inset-0 flex items-center gap-1.5"
              animate={{ opacity: isHovered ? 0 : 1 }}
              transition={{ duration: 0.2 }}
            >
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-2 w-2 rounded-full bg-white/15" />
              ))}
              <span className="ml-2 text-sm text-white/15">TZS</span>
            </motion.div>

            {/* Revealed state: actual balance */}
            <motion.div
              className="absolute inset-0 flex items-center"
              animate={{ opacity: isHovered ? 1 : 0, y: isHovered ? 0 : 6 }}
              transition={{ duration: 0.25, delay: isHovered ? 0.05 : 0 }}
            >
              {walletAddress ? (
                <TokenBalance walletAddress={walletAddress} compact className="text-2xl" />
              ) : (
                <p className="text-2xl font-bold text-white">0 TZS</p>
              )}
            </motion.div>
          </div>
        </div>

        {/* Bottom underline */}
        <motion.div
          className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/30 to-transparent"
          animate={{ opacity: isHovered ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        />
      </motion.div>
    </motion.div>
  )
}
