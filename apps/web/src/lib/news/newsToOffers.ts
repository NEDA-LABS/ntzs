import type { NewsArticle } from './getNews'
import type { Offer } from '@/components/ui/offer-carousel'

const LOGOS: Record<string, string> = {
  citizen: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=80&auto=format&fit=crop',
  dse:     'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=80&auto=format&fit=crop',
  tsl:     'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=80&auto=format&fit=crop',
}

const TAGS: Record<string, string> = {
  citizen: 'National',
  dse:     'Markets',
  tsl:     'Investing',
}

const CITIZEN_IMAGES = [
  'https://images.unsplash.com/photo-1489749798305-4fea3ae63d43?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1578575437130-527eed3abbec?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=600&auto=format&fit=crop',
]

const DSE_IMAGES = [
  'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop',
]

const TSL_IMAGES = [
  'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1565514020179-026b92b84bb6?w=600&auto=format&fit=crop',
]

const POOLS: Record<string, string[]> = {
  citizen: CITIZEN_IMAGES,
  dse:     DSE_IMAGES,
  tsl:     TSL_IMAGES,
}

const counters: Record<string, number> = { citizen: 0, dse: 0, tsl: 0 }

function nextImage(source: string): string {
  const pool = POOLS[source] ?? CITIZEN_IMAGES
  const img = pool[counters[source] % pool.length]
  counters[source]++
  return img
}

export function newsToOffers(articles: NewsArticle[]): Offer[] {
  counters.citizen = 0
  counters.dse = 0
  counters.tsl = 0

  return articles.map((article, i) => {
    const promoCode = article.pubDate
      ? new Date(article.pubDate).toLocaleDateString('en-TZ', { day: 'numeric', month: 'short' })
      : undefined

    return {
      id: `${article.source}-${i}`,
      imageSrc: nextImage(article.source),
      imageAlt: article.title,
      tag: TAGS[article.source] ?? 'News',
      title: article.title,
      description: article.summary,
      brandLogoSrc: LOGOS[article.source] ?? LOGOS.citizen,
      brandName: article.sourceLabel,
      promoCode,
      href: article.href,
    }
  })
}
