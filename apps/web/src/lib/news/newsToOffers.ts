import type { NewsArticle } from './getNews'
import type { Offer } from '@/components/ui/offer-carousel'

const CITIZEN_LOGO =
  'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=80&auto=format&fit=crop'

const DSE_LOGO =
  'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=80&auto=format&fit=crop'

// Pool of Unsplash images relevant to Tanzania / business / finance
const CITIZEN_IMAGES = [
  'https://images.unsplash.com/photo-1489749798305-4fea3ae63d43?w=600&auto=format&fit=crop', // Dar es Salaam waterfront
  'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=600&auto=format&fit=crop', // newspaper / press
  'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=600&auto=format&fit=crop', // business meeting
  'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=600&auto=format&fit=crop', // finance / money
  'https://images.unsplash.com/photo-1578575437130-527eed3abbec?w=600&auto=format&fit=crop', // port / logistics
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&auto=format&fit=crop', // person / interview
]

const DSE_IMAGES = [
  'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&auto=format&fit=crop', // stock chart
  'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=600&auto=format&fit=crop', // trading screen
  'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop', // market data
]

let citizenIdx = 0
let dseIdx = 0

function nextImage(source: 'citizen' | 'dse'): string {
  if (source === 'dse') {
    const img = DSE_IMAGES[dseIdx % DSE_IMAGES.length]
    dseIdx++
    return img
  }
  const img = CITIZEN_IMAGES[citizenIdx % CITIZEN_IMAGES.length]
  citizenIdx++
  return img
}

export function newsToOffers(articles: NewsArticle[]): Offer[] {
  // Reset counters each call so order is stable across renders
  citizenIdx = 0
  dseIdx = 0

  return articles.map((article, i) => {
    const isCitizen = article.source === 'citizen'
    const tag = isCitizen ? 'National' : 'Markets'
    const logo = isCitizen ? CITIZEN_LOGO : DSE_LOGO
    const img = nextImage(article.source)

    const promoCode = article.pubDate
      ? new Date(article.pubDate).toLocaleDateString('en-TZ', { day: 'numeric', month: 'short' })
      : undefined

    return {
      id: `${article.source}-${i}`,
      imageSrc: img,
      imageAlt: article.title,
      tag,
      title: article.title,
      description: article.summary,
      brandLogoSrc: logo,
      brandName: article.sourceLabel,
      promoCode,
      href: article.href,
    }
  })
}
