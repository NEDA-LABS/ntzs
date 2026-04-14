"use client"

import { useEffect, useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import Link from "next/link"

interface AdSlide {
  id: number
  video: string
  eyebrow: string
  headline: string
  sub: string
  ctaLabel: string
  ctaHref: string
  accent: string          // tailwind text colour
  accentBg: string        // tailwind bg colour for CTA pill
  accentRing: string      // tailwind ring colour for CTA pill
}

const slides: AdSlide[] = [
  {
    id: 1,
    video: "/Fintech_Video_With_NTZS_Logo.mp4",
    eyebrow: "Digital Money. Real Value.",
    headline: "Tanzania's first on-chain shilling. Spend, save, grow.",
    sub: "nTZS is pegged 1:1 to the Tanzanian Shilling. No volatility, full control.",
    ctaLabel: "Get started →",
    ctaHref: "/app/user/deposits/new",
    accent: "text-emerald-300",
    accentBg: "bg-emerald-500/20",
    accentRing: "ring-emerald-500/30",
  },
  {
    id: 2,
    video: "/Video_For_Wallet_Service.mp4",
    eyebrow: "Instant. Borderless. Cheap.",
    headline: "Send money faster than a text message.",
    sub: "Skip the bank queues. Send nTZS anywhere in seconds for a fraction of traditional fees.",
    ctaLabel: "Send now →",
    ctaHref: "/app/user/wallet?action=send",
    accent: "text-sky-300",
    accentBg: "bg-sky-500/20",
    accentRing: "ring-sky-500/30",
  },
  {
    id: 3,
    video: "/Stablecoin_Image_To_Video_Generation.mp4",
    eyebrow: "Put your money to work.",
    headline: "Earn up to 8% APY just by holding.",
    sub: "Stake your nTZS and watch it grow. No lock-in, withdraw anytime.",
    ctaLabel: "Stake to earn →",
    ctaHref: "/app/user/stake",
    accent: "text-violet-300",
    accentBg: "bg-violet-500/20",
    accentRing: "ring-violet-500/30",
  },
]

const INTERVAL_MS = 5000

export function AdCampaignCards() {
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)

  const advance = useCallback(() => {
    setCurrent((c) => (c + 1) % slides.length)
  }, [])

  useEffect(() => {
    if (paused) return
    const id = setInterval(advance, INTERVAL_MS)
    return () => clearInterval(id)
  }, [paused, advance])

  const slide = slides[current]

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border/40 bg-black"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* ── Video layer ── */}
      <AnimatePresence mode="sync">
        <motion.video
          key={slide.id}
          src={slide.video}
          autoPlay
          muted
          loop
          playsInline
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7 }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </AnimatePresence>

      {/* ── Dark scrim — heavier at bottom so text always pops ── */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/60 to-black/10 pointer-events-none" />

      {/* ── Content ── */}
      <div className="relative z-10 flex min-h-[260px] flex-col justify-end gap-3 p-5 sm:min-h-[280px] sm:p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="space-y-3"
          >
            {/* Eyebrow */}
            <p className={`text-[11px] font-medium italic tracking-wide ${slide.accent}`}>
              {slide.eyebrow}
            </p>

            {/* Headline */}
            <h3 className="text-xl font-thin leading-tight tracking-tight text-white sm:text-2xl">
              {slide.headline}
            </h3>

            {/* Sub copy */}
            <p className="text-sm font-light text-white/75 leading-relaxed max-w-sm">
              {slide.sub}
            </p>

            {/* CTA + dots */}
            <div className="flex items-center gap-3 pt-0.5">
              <Link
                href={slide.ctaHref}
                className={`inline-flex items-center rounded-full px-4 py-2 text-xs font-bold ${slide.accentBg} ${slide.accent} ring-1 ${slide.accentRing} transition-all hover:brightness-125`}
              >
                {slide.ctaLabel}
              </Link>

              <div className="flex items-center gap-1.5 ml-auto">
                {slides.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => setCurrent(i)}
                    aria-label={`Go to slide ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === current ? "w-5 bg-white" : "w-1.5 bg-white/35 hover:bg-white/60"
                    }`}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
