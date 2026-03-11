'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, ArrowRight, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Offer {
  id: string | number
  imageSrc: string
  imageAlt: string
  tag: string
  title: string
  description: string
  brandLogoSrc: string
  brandName: string
  promoCode?: string
  href: string
}

interface OfferCardProps {
  offer: Offer
}

const OfferCard = React.forwardRef<HTMLAnchorElement, OfferCardProps>(({ offer }, ref) => (
  <motion.a
    ref={ref}
    href={offer.href}
    target="_blank"
    rel="noopener noreferrer"
    className="relative flex-shrink-0 w-[280px] h-[360px] rounded-2xl overflow-hidden group snap-start"
    whileHover={{ y: -6 }}
    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    style={{ perspective: '1000px' }}
  >
    {/* Background Image */}
    <img
      src={offer.imageSrc}
      alt={offer.imageAlt}
      className="absolute inset-0 w-full h-[55%] object-cover transition-transform duration-500 group-hover:scale-110"
    />

    {/* Gradient bleed from card into image */}
    <div className="absolute left-0 right-0 top-[40%] h-20 bg-gradient-to-b from-transparent to-[#12121e]" />

    {/* Card Content */}
    <div className="absolute bottom-0 left-0 right-0 h-[50%] bg-[#12121e] p-4 flex flex-col justify-between">
      <div className="space-y-1.5">
        <div className="flex items-center text-[11px] text-zinc-500">
          <Tag className="w-3 h-3 mr-1.5 text-blue-400" />
          <span className="uppercase tracking-wider font-medium">{offer.tag}</span>
        </div>
        <h3 className="text-sm font-bold text-white leading-snug line-clamp-2">{offer.title}</h3>
        <p className="text-[11px] text-zinc-500 line-clamp-2 leading-relaxed">{offer.description}</p>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <img
            src={offer.brandLogoSrc}
            alt={`${offer.brandName} logo`}
            className="w-7 h-7 rounded-full bg-white/[0.06] object-cover"
          />
          <div>
            <p className="text-[11px] font-semibold text-white">{offer.brandName}</p>
            {offer.promoCode && (
              <p className="text-[10px] text-zinc-600">{offer.promoCode}</p>
            )}
          </div>
        </div>
        <div className="w-7 h-7 rounded-full bg-white/[0.07] flex items-center justify-center text-white transition-all duration-300 group-hover:rotate-[-45deg] group-hover:bg-blue-500">
          <ArrowRight className="w-3.5 h-3.5" />
        </div>
      </div>
    </div>
  </motion.a>
))
OfferCard.displayName = 'OfferCard'

export interface OfferCarouselProps extends React.HTMLAttributes<HTMLDivElement> {
  offers: Offer[]
}

const OfferCarousel = React.forwardRef<HTMLDivElement, OfferCarouselProps>(
  ({ offers, className, ...props }, ref) => {
    const scrollContainerRef = React.useRef<HTMLDivElement>(null)

    const scroll = (direction: 'left' | 'right') => {
      if (scrollContainerRef.current) {
        const { current } = scrollContainerRef
        const scrollAmount = current.clientWidth * 0.8
        current.scrollBy({
          left: direction === 'left' ? -scrollAmount : scrollAmount,
          behavior: 'smooth',
        })
      }
    }

    return (
      <div ref={ref} className={cn('relative w-full group/carousel', className)} {...props}>
        {/* Left Scroll Button */}
        <button
          onClick={() => scroll('left')}
          className="absolute top-1/2 -translate-y-1/2 -left-3 z-10 w-9 h-9 rounded-full bg-[#0d0d14]/80 backdrop-blur-sm border border-white/[0.08] flex items-center justify-center text-white opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-300 hover:bg-white/[0.08]"
          aria-label="Scroll Left"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {/* Scrollable Container */}
        <div
          ref={scrollContainerRef}
          className="flex space-x-4 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory"
        >
          {offers.map((offer) => (
            <OfferCard key={offer.id} offer={offer} />
          ))}
        </div>

        {/* Right Scroll Button */}
        <button
          onClick={() => scroll('right')}
          className="absolute top-1/2 -translate-y-1/2 -right-3 z-10 w-9 h-9 rounded-full bg-[#0d0d14]/80 backdrop-blur-sm border border-white/[0.08] flex items-center justify-center text-white opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-300 hover:bg-white/[0.08]"
          aria-label="Scroll Right"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    )
  }
)
OfferCarousel.displayName = 'OfferCarousel'

export { OfferCarousel, OfferCard }
