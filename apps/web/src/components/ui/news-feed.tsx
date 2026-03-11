'use client'

import type { NewsArticle } from '@/lib/news/getNews'
import { ExternalLink, Newspaper, TrendingUp } from 'lucide-react'

function SourceBadge({ source, label }: { source: 'citizen' | 'dse'; label: string }) {
  if (source === 'dse') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400 ring-1 ring-emerald-500/20">
        <TrendingUp className="h-2.5 w-2.5" />
        {label}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-400 ring-1 ring-blue-500/20">
      <Newspaper className="h-2.5 w-2.5" />
      {label}
    </span>
  )
}

function NewsCard({ article }: { article: NewsArticle }) {
  return (
    <a
      href={article.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex w-60 shrink-0 flex-col gap-2.5 rounded-2xl bg-[#12121e] p-4 ring-1 ring-white/[0.06] transition-all duration-150 hover:bg-white/[0.04] hover:ring-white/10 active:scale-[0.98]"
    >
      <div className="flex items-start justify-between gap-2">
        <SourceBadge source={article.source} label={article.sourceLabel} />
        <ExternalLink className="h-3 w-3 shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400" />
      </div>

      <p className="line-clamp-3 text-xs font-semibold leading-snug text-white/80">
        {article.title}
      </p>

      {article.summary && article.summary !== article.title && (
        <p className="line-clamp-2 text-[11px] leading-relaxed text-zinc-500">
          {article.summary}
        </p>
      )}

      {article.pubDate && (
        <p className="mt-auto text-[10px] text-zinc-600">
          {new Date(article.pubDate).toLocaleDateString('en-TZ', {
            day: 'numeric',
            month: 'short',
          })}
        </p>
      )}
    </a>
  )
}

export function NewsFeed({ articles }: { articles: NewsArticle[] }) {
  if (!articles.length) return null

  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center justify-between px-0.5">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
          Market &amp; News
        </p>
        <div className="flex items-center gap-2">
          <a
            href="https://www.thecitizen.co.tz/tanzania/news/national"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            The Citizen
          </a>
          <span className="text-zinc-700">·</span>
          <a
            href="https://dse.co.tz/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            DSE
          </a>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
        {articles.map((article) => (
          <NewsCard key={article.href} article={article} />
        ))}
      </div>
    </div>
  )
}
