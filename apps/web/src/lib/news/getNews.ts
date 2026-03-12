import { unstable_cache } from 'next/cache'

export interface NewsArticle {
  href: string
  title: string
  summary: string
  source: 'citizen' | 'dse' | 'tsl'
  sourceLabel: string
  pubDate?: string
  imageSrc?: string
}

const DSE_FALLBACK: NewsArticle = {
  href: 'https://dse.co.tz/',
  title: 'Dar es Salaam Stock Exchange',
  summary: 'Visit DSE for live equity prices, bond yields, and listed company data.',
  source: 'dse',
  sourceLabel: 'DSE',
}

async function scrapeTSL(limit = 4): Promise<NewsArticle[]> {
  try {
    const res = await fetch('https://www.tanzaniasecurities.co.tz/blog', {
      next: { revalidate: 3600 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok) return []
    const html = await res.text()

    const articles: NewsArticle[] = []
    const seen = new Set<string>()

    // Match /post/N article links — both quote styles
    const linkRe = /href=["']((?:https?:\/\/www\.tanzaniasecurities\.co\.tz)?\/post\/\d+)["']/g
    let m: RegExpExecArray | null

    while ((m = linkRe.exec(html)) !== null && articles.length < limit) {
      const raw = m[1]
      const href = raw.startsWith('http') ? raw : `https://www.tanzaniasecurities.co.tz${raw}`
      if (seen.has(href)) continue
      seen.add(href)

      const ctxStart = Math.max(0, m.index - 300)
      const ctxEnd = Math.min(html.length, m.index + 500)
      const ctx = html.slice(ctxStart, ctxEnd)

      const h2 = ctx.match(/<h[23][^>]*>\s*([\s\S]{5,200}?)\s*<\/h[23]>/)
      const titleRaw = h2?.[1] ?? ''
      const title = titleRaw.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').trim()

      if (!title || title.length < 6) continue

      articles.push({
        href,
        title: title.slice(0, 120),
        summary: 'Market insights and investment analysis from Tanzania Securities Limited.',
        source: 'tsl',
        sourceLabel: 'Tanzania Securities',
      })
    }

    return articles
  } catch {
    return []
  }
}

function extractImg(ctx: string): string | undefined {
  const m = ctx.match(/src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*?)["']/)
  if (!m) return undefined
  const src = m[1]
  if (src.startsWith('data:') || src.length < 10) return undefined
  return src.startsWith('http') ? src : `https://www.thecitizen.co.tz${src}`
}

async function scrapeTheCitizen(limit = 6): Promise<NewsArticle[]> {
  try {
    const res = await fetch('https://www.thecitizen.co.tz/tanzania/news/national', {
      next: { revalidate: 3600 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
    })
    if (!res.ok) return []
    const html = await res.text()

    const articles: NewsArticle[] = []
    const seen = new Set<string>()

    // Match both absolute and relative article URLs, both quote styles
    const linkRe = /href=["']((?:https?:\/\/www\.thecitizen\.co\.tz)?\/tanzania\/news\/national\/[^"'?#]{10,})["']/g
    let m: RegExpExecArray | null

    while ((m = linkRe.exec(html)) !== null && articles.length < limit) {
      const raw = m[1]
      const href = raw.startsWith('http') ? raw : `https://www.thecitizen.co.tz${raw}`
      if (seen.has(href)) continue
      seen.add(href)

      const ctxStart = Math.max(0, m.index - 600)
      const ctxEnd = Math.min(html.length, m.index + 600)
      const ctx = html.slice(ctxStart, ctxEnd)

      const h = ctx.match(/<h[1-4][^>]*>\s*([\s\S]{5,200}?)\s*<\/h[1-4]>/)
      const titleRaw = h?.[1] ?? ''
      const title = titleRaw.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, ' ').trim()
      if (!title || title.length < 8) continue

      const imageSrc = extractImg(ctx)

      articles.push({
        href,
        title: title.slice(0, 120),
        summary: title.slice(0, 100),
        source: 'citizen',
        sourceLabel: 'The Citizen',
        imageSrc,
      })
    }

    return articles
  } catch {
    return []
  }
}

export const getNews = unstable_cache(
  async (): Promise<NewsArticle[]> => {
    const [citizenArticles, tslArticles] = await Promise.all([
      scrapeTheCitizen(6),
      scrapeTSL(4),
    ])

    if (citizenArticles.length === 0 && tslArticles.length === 0) {
      return [
        {
          href: 'https://www.thecitizen.co.tz/tanzania/news/national',
          title: 'Latest News from Tanzania',
          summary: 'Stay up to date with national and business news from Tanzania.',
          source: 'citizen',
          sourceLabel: 'The Citizen',
        },
        DSE_FALLBACK,
        {
          href: 'https://www.tanzaniasecurities.co.tz/blog',
          title: 'Tanzania Securities — Insights',
          summary: 'Market insights and investment analysis from Tanzania Securities Limited.',
          source: 'tsl',
          sourceLabel: 'Tanzania Securities',
        },
      ]
    }

    // Interleave: citizen → tsl → citizen → tsl → ... with DSE card at position 2
    const result: NewsArticle[] = []
    const cLen = citizenArticles.length
    const tLen = tslArticles.length
    const total = cLen + tLen
    let ci = 0
    let ti = 0

    for (let i = 0; i < total; i++) {
      if (i === 2 && ci < cLen) {
        result.push(DSE_FALLBACK)
      }
      if (i % 2 === 0 && ci < cLen) {
        result.push(citizenArticles[ci++])
      } else if (ti < tLen) {
        result.push(tslArticles[ti++])
      } else if (ci < cLen) {
        result.push(citizenArticles[ci++])
      }
    }

    return result
  },
  ['news-feed'],
  { revalidate: 3600 }
)
