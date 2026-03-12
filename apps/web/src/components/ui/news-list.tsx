"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowUpRight, ChevronDown, Newspaper, TrendingUp } from "lucide-react"
import type { NewsArticle } from "@/lib/news/getNews"

const SOURCE_STYLES: Record<string, { dot: string; text: string; label: string; dimText: string }> = {
  citizen: { dot: "bg-blue-400",    text: "text-blue-400",    dimText: "text-blue-400/60",    label: "National"  },
  dse:     { dot: "bg-emerald-400", text: "text-emerald-400", dimText: "text-emerald-400/60", label: "Markets"   },
  tsl:     { dot: "bg-violet-400",  text: "text-violet-400",  dimText: "text-violet-400/60",  label: "Investing" },
}

function NewsRow({ article, index }: { article: NewsArticle; index: number }) {
  const [open, setOpen] = useState(false)
  const s = SOURCE_STYLES[article.source] ?? SOURCE_STYLES.citizen

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.04 }}
    >
      {/* Collapsed row — tap to expand */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] active:bg-white/[0.04]"
      >
        {/* Thumbnail */}
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-white/[0.04]">
          {article.imageSrc ? (
            <img
              src={article.imageSrc}
              alt={article.title}
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              {article.source === "citizen"
                ? <Newspaper className={`h-4 w-4 ${s.dimText}`} />
                : <TrendingUp className={`h-4 w-4 ${s.dimText}`} />
              }
            </div>
          )}
        </div>

        {/* Title + meta */}
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-white/90">
            {article.title}
          </p>
          <div className="flex items-center gap-1.5">
            <span className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${s.text}`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
              {s.label}
            </span>
            {article.pubDate && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="text-[10px] text-zinc-600">
                  {new Date(article.pubDate).toLocaleDateString("en-TZ", { day: "numeric", month: "short" })}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Chevron toggle */}
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 text-zinc-600"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.div>
      </button>

      {/* Expanded panel */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="flex gap-3 px-4 pb-4">
              {/* Tall image when expanded */}
              {article.imageSrc && (
                <div className="h-24 w-20 shrink-0 overflow-hidden rounded-xl">
                  <img
                    src={article.imageSrc}
                    alt={article.title}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </div>
              )}

              <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
                {/* Summary */}
                <p className="text-[12px] leading-relaxed text-zinc-400">
                  {article.summary && article.summary !== article.title
                    ? article.summary
                    : `${article.sourceLabel} — tap to read the full story.`}
                </p>

                {/* View more */}
                <a
                  href={article.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={`inline-flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${s.text} bg-white/[0.05] hover:bg-white/[0.08]`}
                >
                  View more
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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

      <div className="overflow-hidden rounded-2xl bg-[#12121e] ring-1 ring-white/[0.06]">
        {articles.map((article, i) => (
          <div key={`${article.source}-${i}`}>
            {i > 0 && <div className="mx-4 h-px bg-white/[0.04]" />}
            <NewsRow article={article} index={i} />
          </div>
        ))}
      </div>
    </div>
  )
}
