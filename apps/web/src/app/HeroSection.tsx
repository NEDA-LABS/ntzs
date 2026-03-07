'use client'

import Link from 'next/link'
import ScrollExpandMedia from '@/components/ui/scroll-expansion-hero'

export default function HeroSection() {
  return (
    <ScrollExpandMedia
      mediaType="video"
      mediaSrc="/HERO VIDEO.mp4"
      bgClassName="bg-gradient-to-br from-black via-zinc-900 to-black"
      title="The Smart Wallet Infrastructure"
      scrollToExpand="Scroll to explore"
    >
      {/* Final expanded state matching the image */}
      <div className="flex flex-col items-center text-center px-6 py-20">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight max-w-4xl">
          The Smart Wallet Infrastructure
        </h1>
        <h2 className="mt-4 text-2xl sm:text-3xl lg:text-4xl font-light text-white/90 max-w-3xl">
          for Africa's Digital Economy
        </h2>
        
        <p className="mt-8 text-base sm:text-lg text-zinc-400 max-w-2xl leading-relaxed">
          Issue wallets. Move money, Build financial products.
          <br />
          Powered by nTZS.
        </p>

        {/* CTA Buttons */}
        <div className="mt-10 flex flex-col sm:flex-row gap-4 items-center justify-center">
          <Link
            href="/app"
            className="inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white bg-blue-600 border border-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            Create Wallet
          </Link>
          <Link
            href="/landing"
            className="inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white bg-transparent border border-white/30 rounded-md hover:bg-white/10 transition-colors"
          >
            Explore Infrastructure
          </Link>
        </div>

        {/* Footer */}
        <footer className="mt-32 w-full border-t border-white/5 pt-6 text-center text-xs text-zinc-600">
          <p>&copy; {new Date().getFullYear()} nTZS -- Secure digital payments for Tanzania</p>
        </footer>
      </div>
    </ScrollExpandMedia>
  )
}
