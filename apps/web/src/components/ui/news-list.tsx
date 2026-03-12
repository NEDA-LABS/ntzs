"use client"

import { motion } from "framer-motion"
import { ArrowUpRight, Newspaper, TrendingUp } from "lucide-react"
import type { NewsArticle } from "@/lib/news/getNews"

const SOURCE_STYLES: Record<string, { dot: string; text: string; label: string }> = {
  citizen:  { dot: "bg-blue-400",    text: "text-blue-400",    label: "National"   },
  dse:      { dot: "bg-emerald-400", text: "text-emerald-400", label: "Markets"    },
  tsl:      { dot: "bg-violet-400",  text: "text-violet-400",  label: "Investing"  },
}

function NewsRow({ article, index }: { article: NewsArticle; index: number }) {
  const s = SOURCE_STYLES[article.source] ?? SOURCE_STYLES.citizen

  return (
    <motion.a
      href={article.href}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03] active:bg-white/[0.05]"
    >
      {/* Thumbnail or coloured placeholder */}
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/[0.04]">
        {article.imageSrc ? (
          <img
            src={article.imageSrc}
            alt={article.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {article.source === "citizen"
              ? <Newspaper className="h-5 w-5 text-blue-400/60" />
              : <TrendingUp className="h-5 w-5 text-emerald-400/60" />
            }
          </div>
        )}
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-white/90 transition-colors group-hover:text-white">
          {article.title}
        </p>
        <div className="flex items-center gap-2">
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

      {/* Arrow */}
      <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-700 transition-all duration-200 group-hover:text-zinc-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </motion.a>
  )
}

export function NewsList({ articles }: { articles: NewsArticle[] }) {
  if (!articles.length) return null

  return (
    <div className="mt-5">
      {/* Section header */}
      <div className="mb-3 flex items-center justify-between px-0.5">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
          Market &amp; News
        </p>
        <div className="flex items-center gap-2">
          <a
            href="https://www.thecitizen.co.tz/tanzania/news/national"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-zinc-600 transition-colors hover:text-zinc-400"
          >
            The Citizen
          </a>
          <span className="text-zinc-700">·</span>
          <a
            href="https://dse.co.tz/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-zinc-600 transition-colors hover:text-zinc-400"
          >
            DSE
          </a>
          <span className="text-zinc-700">·</span>
          <a
            href="https://www.tanzaniasecurities.co.tz/blog"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-zinc-600 transition-colors hover:text-zinc-400"
          >
            TSL
          </a>
        </div>
      </div>

      {/* Card container */}
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
