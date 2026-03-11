import { unstable_cache } from 'next/cache'

export interface NewsArticle {
  href: string
  title: string
  summary: string
  source: 'citizen' | 'dse'
  sourceLabel: string
  pubDate?: string
}

const DSE_FALLBACK: NewsArticle = {
  href: 'https://dse.co.tz/',
  title: 'Dar es Salaam Stock Exchange',
  summary: 'Visit DSE for live equity prices, bond yields, and listed company data.',
  source: 'dse',
  sourceLabel: 'DSE',
}

async function scrapeTheCitizen(limit = 6): Promise<NewsArticle[]> {
  try {
    const res = await fetch('https://www.thecitizen.co.tz/tanzania/news/national', {
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

    // Match article links: /tanzania/news/national/article-slug-NNNNNNN
    const linkRe = /href="(https?:\/\/www\.thecitizen\.co\.tz\/tanzania\/news\/national\/[^"?#]{10,})"/g
    let m: RegExpExecArray | null

    while ((m = linkRe.exec(html)) !== null && articles.length < limit) {
      const href = m[1]
      if (seen.has(href)) continue
      seen.add(href)

      // Extract surrounding text context (up to 600 chars after the href)
      const contextStart = Math.max(0, m.index - 400)
      const contextEnd = Math.min(html.length, m.index + 600)
      const ctx = html.slice(contextStart, contextEnd)

      // Try to find a heading near this link
      const h3 = ctx.match(/<h[23][^>]*>\s*([\s\S]{5,200}?)\s*<\/h[23]>/)
      const titleRaw = h3?.[1] ?? ''
      const title = titleRaw.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').trim()

      if (!title || title.length < 8) continue

      // Build a short summary from meta description if visible, else re-use title
      const descMatch = html.slice(m.index, m.index + 800).match(/class="[^"]*summary[^"]*"[^>]*>([\s\S]{10,200}?)</)
      const summary = descMatch
        ? descMatch[1].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim().slice(0, 120)
        : title.slice(0, 100)

      articles.push({ href, title: title.slice(0, 120), summary, source: 'citizen', sourceLabel: 'The Citizen' })
    }

    return articles
  } catch {
    return []
  }
}

export const getNews = unstable_cache(
  async (): Promise<NewsArticle[]> => {
    const citizenArticles = await scrapeTheCitizen(6)

    // DSE stock data is JavaScript-rendered and cannot be scraped via HTTP.
    // Interleave citizen articles with a single DSE promo card.
    if (citizenArticles.length === 0) {
      return [
        {
          href: 'https://www.thecitizen.co.tz/tanzania/news/national',
          title: 'Latest News from Tanzania',
          summary: 'Stay up to date with national and business news from Tanzania.',
          source: 'citizen',
          sourceLabel: 'The Citizen',
        },
        DSE_FALLBACK,
      ]
    }

    // Insert DSE card at position 2
    const result = [...citizenArticles]
    result.splice(2, 0, DSE_FALLBACK)
    return result
  },
  ['news-feed'],
  { revalidate: 3600 }
)
