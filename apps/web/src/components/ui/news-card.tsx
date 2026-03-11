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
import { ExternalLink, Newspaper, TrendingUp } from "lucide-react"
import type { NewsArticle } from "@/lib/news/getNews"

const SOURCE_COLORS: Record<string, { dot: string; text: string; bg: string; hex: string }> = {
  citizen: { dot: "bg-blue-400",   text: "text-blue-400",   bg: "rgba(59,130,246,0.08)",  hex: "#60a5fa" },
  dse:     { dot: "bg-emerald-400", text: "text-emerald-400", bg: "rgba(52,211,153,0.08)", hex: "#34d399" },
  tsl:     { dot: "bg-violet-400",  text: "text-violet-400",  bg: "rgba(139,92,246,0.08)", hex: "#a78bfa" },
}

const SOURCE_TAGS: Record<string, string> = {
  citizen: "National",
  dse:     "Markets",
  tsl:     "Investing",
}

interface NewsCardProps {
  article: NewsArticle
}

export function NewsCard({ article }: NewsCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)
  const rotateX = useTransform(mouseY, [-50, 50], [6, -6])
  const rotateY = useTransform(mouseX, [-50, 50], [-6, 6])
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

  const colors = SOURCE_COLORS[article.source] ?? SOURCE_COLORS.citizen
  const tag = SOURCE_TAGS[article.source] ?? "News"

  return (
    <motion.div
      ref={containerRef}
      className="relative select-none"
      style={{ perspective: 1000 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <motion.div
        className="relative cursor-pointer overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0d0d14]"
        style={{
          rotateX: springRotateX,
          rotateY: springRotateY,
          transformStyle: "preserve-3d",
        }}
        animate={{
          width: isExpanded ? 300 : 220,
          height: isExpanded ? 260 : 130,
        }}
        transition={{ type: "spring", stiffness: 400, damping: 35 }}
      >
        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-white/[0.04]" />

        {/* Expanded state: grid + summary */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              className="pointer-events-none absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, delay: 0.08 }}
            >
              <div className="absolute inset-0 rounded-2xl bg-[#12121e]" />

              {/* Road grid */}
              <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
                <motion.line x1="0%" y1="38%" x2="100%" y2="38%" stroke="rgba(255,255,255,0.12)" strokeWidth="3" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, delay: 0.15 }} />
                <motion.line x1="0%" y1="68%" x2="100%" y2="68%" stroke="rgba(255,255,255,0.12)" strokeWidth="3" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, delay: 0.2 }} />
                <motion.line x1="30%" y1="0%" x2="30%" y2="100%" stroke="rgba(255,255,255,0.08)" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.25 }} />
                <motion.line x1="72%" y1="0%" x2="72%" y2="100%" stroke="rgba(255,255,255,0.08)" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.3 }} />
                {[18, 52, 82].map((y, i) => (
                  <motion.line key={`h-${i}`} x1="0%" y1={`${y}%`} x2="100%" y2={`${y}%`} stroke="rgba(255,255,255,0.05)" strokeWidth="1" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.35 + i * 0.05 }} />
                ))}
                {[14, 50, 86].map((x, i) => (
                  <motion.line key={`v-${i}`} x1={`${x}%`} y1="0%" x2={`${x}%`} y2="100%" stroke="rgba(255,255,255,0.05)" strokeWidth="1" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.4 + i * 0.05 }} />
                ))}
              </svg>

              {/* Bottom fade */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#12121e] via-transparent to-transparent opacity-80" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapsed grid watermark */}
        <motion.div
          className="absolute inset-0"
          animate={{ opacity: isExpanded ? 0 : 0.04 }}
          transition={{ duration: 0.3 }}
        >
          <svg width="100%" height="100%">
            <defs>
              <pattern id={`ng-${article.source}`} width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#ng-${article.source})`} />
          </svg>
        </motion.div>

        {/* Card content */}
        <div className="relative z-10 flex h-full flex-col justify-between p-4">
          {/* Top row */}
          <div className="flex items-start justify-between">
            <motion.div animate={{ opacity: isExpanded ? 0 : 1 }} transition={{ duration: 0.2 }}>
              {article.source === 'citizen'
                ? <Newspaper className="h-4 w-4 text-blue-400" style={{ filter: isHovered ? "drop-shadow(0 0 6px rgba(96,165,250,0.7))" : "drop-shadow(0 0 3px rgba(96,165,250,0.3))" }} />
                : <TrendingUp className="h-4 w-4 text-emerald-400" style={{ filter: isHovered ? "drop-shadow(0 0 6px rgba(52,211,153,0.7))" : "drop-shadow(0 0 3px rgba(52,211,153,0.3))" }} />
              }
            </motion.div>

            <div className="flex items-center gap-2">
              {/* Source tag */}
              <motion.div
                className="flex items-center gap-1 rounded-full px-2 py-0.5 backdrop-blur-sm"
                animate={{ backgroundColor: isHovered ? colors.bg : "rgba(255,255,255,0.04)" }}
                transition={{ duration: 0.2 }}
              >
                <div className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                <span className={`text-[9px] font-semibold uppercase tracking-wider ${colors.text}`}>{tag}</span>
              </motion.div>

              {/* External link — only explicit tap opens article */}
              <a
                href={article.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.04] text-zinc-600 transition-colors hover:bg-white/[0.08] hover:text-zinc-400"
                aria-label="Open article"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          {/* Bottom section */}
          <div className="space-y-1.5">
            <motion.h3
              className="text-sm font-semibold leading-snug text-white"
              style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}
              animate={{ x: isHovered ? 3 : 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              {article.title}
            </motion.h3>

            <AnimatePresence>
              {isExpanded && (
                <motion.p
                  className="text-[11px] leading-relaxed text-zinc-500"
                  style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  transition={{ duration: 0.22 }}
                >
                  {article.summary}
                </motion.p>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-between">
              <motion.div
                className="h-px flex-1 bg-gradient-to-r to-transparent"
                style={{ backgroundImage: `linear-gradient(to right, ${colors.hex}, transparent)` }}
                initial={{ scaleX: 0, originX: 0 }}
                animate={{ scaleX: isHovered || isExpanded ? 1 : 0.25 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>

            <AnimatePresence>
              {isExpanded && (
                <motion.p
                  className="text-[10px] font-medium uppercase tracking-widest text-zinc-600"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, delay: 0.1 }}
                >
                  {article.sourceLabel}
                  {article.pubDate ? ` · ${new Date(article.pubDate).toLocaleDateString("en-TZ", { day: "numeric", month: "short" })}` : ""}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
