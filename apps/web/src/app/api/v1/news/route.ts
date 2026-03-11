import { NextResponse } from 'next/server'

export interface NewsArticle {
  href: string
  title: string
  summary: string
  source: 'citizen' | 'dse'
  sourceLabel: string
  pubDate?: string
}

function extractItems(xml: string, source: 'citizen' | 'dse', sourceLabel: string, limit = 4): NewsArticle[] {
  const items: NewsArticle[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match

  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1]

    const title = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)
      ?.[1]?.trim()
      ?? block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim()
      ?? ''

    const link = block.match(/<link>([\s\S]*?)<\/link>/)
      ?.[1]?.trim()
      ?? block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1]?.trim()
      ?? ''

    const desc = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)
      ?.[1]
      ?? block.match(/<description>([\s\S]*?)<\/description>/)?.[1]
      ?? ''

    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? ''

    const cleanDesc = desc.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim().slice(0, 120)

    if (title && link) {
      items.push({ href: link, title, summary: cleanDesc || title, source, sourceLabel, pubDate })
    }
  }

  return items
}

async function fetchRSS(url: string, source: 'citizen' | 'dse', label: string): Promise<NewsArticle[]> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; nTZS/1.0)' },
    })
    if (!res.ok) return []
    const xml = await res.text()
    return extractItems(xml, source, label)
  } catch {
    return []
  }
}

export async function GET() {
  const [citizen, dse] = await Promise.allSettled([
    fetchRSS('https://www.thecitizen.co.tz/feed', 'citizen', 'The Citizen'),
    fetchRSS('https://dse.co.tz/feed', 'dse', 'DSE'),
  ])

  const citizenArticles = citizen.status === 'fulfilled' ? citizen.value : []
  const dseArticles = dse.status === 'fulfilled' ? dse.value : []

  const articles: NewsArticle[] = []

  const max = Math.max(citizenArticles.length, dseArticles.length)
  for (let i = 0; i < max; i++) {
    if (citizenArticles[i]) articles.push(citizenArticles[i])
    if (dseArticles[i]) articles.push(dseArticles[i])
  }

  if (articles.length === 0) {
    const fallback: NewsArticle[] = [
      {
        href: 'https://www.thecitizen.co.tz/tanzania/news/national',
        title: 'Latest News from The Citizen',
        summary: 'Stay up to date with national news from Tanzania.',
        source: 'citizen',
        sourceLabel: 'The Citizen',
      },
      {
        href: 'https://dse.co.tz/',
        title: 'Dar es Salaam Stock Exchange',
        summary: 'Follow market performance and listed company updates.',
        source: 'dse',
        sourceLabel: 'DSE',
      },
    ]
    return NextResponse.json(fallback)
  }

  return NextResponse.json(articles)
}
