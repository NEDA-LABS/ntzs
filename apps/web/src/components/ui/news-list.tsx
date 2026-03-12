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
import { ArrowUpRight } from "lucide-react"
import type { NewsArticle } from "@/lib/news/getNews"
import { WebViewModal } from "@/components/ui/web-view-modal"

const SOURCE_STYLES: Record<string, {
  label: string
  accent: string          // text colour
  gradient: string        // radial bg gradient
  underline: string       // gradient underline
  btn: string             // CTA button colours
}> = {
  citizen: {
    label:    "National",
    accent:   "text-blue-400/80",
    gradient: "radial-gradient(circle at 15% 0%,rgba(59,130,246,0.20),transparent 50%),radial-gradient(circle at 85% 100%,rgba(96,165,250,0.10),transparent 55%)",
    underline:"from-blue-500/60 via-blue-400/30 to-transparent",
    btn:      "bg-gradient-to-r from-blue-600 to-blue-500 shadow-blue-500/25 hover:shadow-blue-500/40",
  },
  dse: {
    label:    "Markets",
    accent:   "text-emerald-400/80",
    gradient: "radial-gradient(circle at 15% 0%,rgba(16,185,129,0.18),transparent 50%),radial-gradient(circle at 85% 100%,rgba(52,211,153,0.10),transparent 55%)",
    underline:"from-emerald-500/60 via-emerald-400/30 to-transparent",
    btn:      "bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-emerald-500/25 hover:shadow-emerald-500/40",
  },
  tsl: {
    label:    "Investing",
    accent:   "text-violet-400/80",
    gradient: "radial-gradient(circle at 15% 0%,rgba(139,92,246,0.20),transparent 50%),radial-gradient(circle at 85% 100%,rgba(167,139,250,0.10),transparent 55%)",
    underline:"from-violet-500/60 via-violet-400/30 to-transparent",
    btn:      "bg-gradient-to-r from-violet-600 to-violet-500 shadow-violet-500/25 hover:shadow-violet-500/40",
  },
}

function NewsCard({ article, index }: { article: NewsArticle; index: number }) {
  const [isHovered, setIsHovered] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const s = SOURCE_STYLES[article.source] ?? SOURCE_STYLES.citizen

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

  const expandedHeight = article.imageSrc ? 320 : 260

  return (
    <motion.div
      ref={containerRef}
      className="relative cursor-pointer select-none"
      style={{ perspective: 1200 }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.05 }}
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
        animate={{ height: isExpanded ? expandedHeight : 130 }}
        transition={{ type: "spring", stiffness: 350, damping: 32 }}
      >
        {/* Radial gradient background */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: s.gradient }}
        />

        {/* Hover shimmer */}
        <motion.div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_35%,rgba(255,255,255,0.04)_50%,transparent_65%)]"
          animate={{ opacity: isHovered ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        />

        {/* Card content */}
        <div className="relative z-10 flex h-full flex-col p-5">

          {/* Header */}
          <div className="flex items-center justify-between">
            <span className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${s.accent}`}>
              {s.label}
            </span>
            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-[10px] font-medium uppercase tracking-widest text-white/40">
                Live
              </span>
            </div>
          </div>

          {/* Title block */}
          <motion.div
            className="mt-auto"
            animate={{ y: isExpanded ? -4 : 0 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
          >
            <p className="line-clamp-2 text-sm font-bold leading-snug text-white">
              {article.title}
            </p>
            <div className="mt-1 text-[11px] text-white/35">{article.sourceLabel}</div>

            {/* Animated underline */}
            <motion.div
              className={`mt-3 h-px bg-gradient-to-r ${s.underline}`}
              animate={{ scaleX: isHovered || isExpanded ? 1 : 0.2, originX: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </motion.div>

          {/* Expanded panel */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                className="mt-4 space-y-3"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.22, delay: 0.04 }}
              >
                {/* Thumbnail if available */}
                {article.imageSrc && (
                  <div className="h-24 w-full overflow-hidden rounded-2xl">
                    <img
                      src={article.imageSrc}
                      alt={article.title}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  </div>
                )}

                {/* Summary */}
                <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3">
                  <p className="text-xs leading-relaxed text-white/50">
                    {article.summary && article.summary !== article.title
                      ? article.summary
                      : `${article.sourceLabel} — tap below to read the full story.`}
                  </p>
                </div>

                {/* CTA — opens in-app browser */}
                <button
                  onClick={(e) => { e.stopPropagation(); setBrowserOpen(true) }}
                  className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-white shadow-lg transition-all duration-75 active:scale-[0.98] ${s.btn}`}
                >
                  Read full story
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <WebViewModal
        href={article.href}
        title={article.title}
        sourceLabel={article.sourceLabel}
        isOpen={browserOpen}
        onClose={() => setBrowserOpen(false)}
      />

      {/* Tap hint */}
      <motion.p
        className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-white/25"
        animate={{ opacity: isHovered && !isExpanded ? 1 : 0, y: isHovered ? 0 : 4 }}
        transition={{ duration: 0.2 }}
      >
        Tap to preview
      </motion.p>
    </motion.div>
  )
}

export function NewsList({ articles }: { articles: NewsArticle[] }) {
  if (!articles.length) return null

  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center justify-between px-0.5">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
          Market &amp; News
        </p>
        <div className="flex items-center gap-2">
          <a href="https://www.thecitizen.co.tz/tanzania/news/national" target="_blank" rel="noopener noreferrer" className="text-[10px] text-zinc-600 transition-colors hover:text-zinc-400">The Citizen</a>
          <span className="text-zinc-700">·</span>
          <a href="https://dse.co.tz/" target="_blank" rel="noopener noreferrer" className="text-[10px] text-zinc-600 transition-colors hover:text-zinc-400">DSE</a>
          <span className="text-zinc-700">·</span>
          <a href="https://www.tanzaniasecurities.co.tz/blog" target="_blank" rel="noopener noreferrer" className="text-[10px] text-zinc-600 transition-colors hover:text-zinc-400">TSL</a>
        </div>
      </div>

      <div className="space-y-3">
        {articles.map((article, i) => (
          <NewsCard key={`${article.source}-${i}`} article={article} index={i} />
        ))}
      </div>
    </div>
  )
}
