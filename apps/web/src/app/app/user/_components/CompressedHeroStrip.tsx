'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUp, Wallet, Link2 } from 'lucide-react'

interface CompressedHeroStripProps {
  displayName: string
}

export function CompressedHeroStrip({ displayName }: CompressedHeroStripProps) {
  const [isCompressed, setIsCompressed] = useState(false)
  const router = useRouter()
  const initial = displayName.slice(0, 1).toUpperCase()

  useEffect(() => {
    const onScroll = () => setIsCompressed(window.scrollY > 80)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <AnimatePresence>
      {isCompressed && (
        <motion.div
          initial={{ y: -48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -48, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          className="sticky top-14 z-30 lg:hidden"
        >
          <div
            className="flex cursor-pointer items-center justify-between border-b border-white/[0.06] bg-[#0d0d14]/95 px-4 py-2.5 backdrop-blur-md"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            {/* Left: avatar + name */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500">
                <span className="text-[11px] font-bold text-white">{initial}</span>
              </div>
              <div>
                <p className="text-[13px] font-semibold leading-tight text-white">
                  @{displayName}
                </p>
                <p className="text-[10px] leading-tight text-zinc-600">
                  ··· TZS · tap to expand
                </p>
              </div>
            </div>

            {/* Right: compact action icons */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); router.push('/app/user/deposits/new') }}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.07] text-white/60 transition-colors active:bg-white/[0.14]"
                aria-label="Deposit"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); router.push('/app/user/stake') }}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.07] text-white/60 transition-colors active:bg-white/[0.14]"
                aria-label="Save"
              >
                <Wallet className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); router.push('/app/user/wallet') }}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.07] text-white/60 transition-colors active:bg-white/[0.14]"
                aria-label="Pay Me"
              >
                <Link2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
