'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { motion, useInView } from 'framer-motion'
import ScrollExpandSection from '@/components/ui/scroll-expand-section'

/* ── Fade-in wrapper for content inside expanded sections ── */
function FadeIn({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-100px', amount: 0.2 })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30, scale: 0.97 }}
      animate={isInView ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 30, scale: 0.97 }}
      transition={{ 
        duration: 0.9, 
        delay, 
        ease: [0.25, 0.1, 0.25, 1],
        opacity: { duration: 0.6 },
        scale: { duration: 0.9, ease: [0.34, 1.56, 0.64, 1] }
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export default function LandingSections() {
  return (
    <div className="relative">
      {/* ─────────────────────────────────────────────────── */}
      {/* SECTION 1: ABOUT                                    */}
      {/* ─────────────────────────────────────────────────── */}
      <div id="about-section">
        <ScrollExpandSection
          videoSrc="/ntzs_demo.mp4"
          overlayClassName="bg-gradient-to-t from-black/90 via-black/60 to-black/80"
        >
        <div className="mx-auto w-full max-w-6xl px-6 lg:px-12">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-zinc-400 backdrop-blur-xl">
                About nTZS
              </div>
              <h2 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
                Tanzania&apos;s first
                <br />
                digital asset reserve.
              </h2>
              <p className="mt-6 text-base leading-relaxed text-zinc-300 sm:text-lg">
                Real money. Instant movement.
                <br />
                nTZS is programmable Tanzanian Shillings — backed 1:1 by regulated deposits, settled in real time, secured on-chain.
              </p>
              <div className="mt-8">
                <Link
                  href="/landing"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-medium text-white backdrop-blur-xl transition-all hover:bg-white/20"
                >
                  Learn more about nTZS
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
              </div>
            </div>

            <div className="hidden md:block" />
          </div>
        </div>
        </ScrollExpandSection>
      </div>

      {/* ─────────────────────────────────────────────────── */}
      {/* SECTION 2: WALLET                                   */}
      {/* ─────────────────────────────────────────────────── */}
      <div id="wallet-section">
        <ScrollExpandSection
          videoSrc="/Video_For_Wallet_Service.mp4"
          videoEndTime={6}
          overlayClassName="bg-gradient-to-t from-black/90 via-black/50 to-black/70"
        >
        <div className="mx-auto w-full max-w-6xl px-6 lg:px-12">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <FadeIn className="order-2 md:order-1">
              <div className="hidden md:block" />
            </FadeIn>

            <FadeIn delay={0.1} className="order-1 md:order-2">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-zinc-400 backdrop-blur-xl">
                Smart Wallet
              </div>
              <h2 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
                One wallet.
                <br />
                Infinite possibilities.
              </h2>
              <p className="mt-6 text-base leading-relaxed text-zinc-300 sm:text-lg">
                Deposit via mobile money, hold digital TZS, send to anyone
                instantly. The nTZS Smart Wallet is your gateway to a new
                financial system -- no bank account required, no hidden fees,
                no waiting.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-xl">
                  <div className="text-2xl font-bold text-white">0s</div>
                  <div className="mt-1 text-xs text-zinc-500">Settlement time</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-xl">
                  <div className="text-2xl font-bold text-white">24/7</div>
                  <div className="mt-1 text-xs text-zinc-500">Always available</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-xl">
                  <div className="text-2xl font-bold text-white">0%</div>
                  <div className="mt-1 text-xs text-zinc-500">Transfer fees</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-xl">
                  <div className="text-2xl font-bold text-white">1:1</div>
                  <div className="mt-1 text-xs text-zinc-500">TZS backed</div>
                </div>
              </div>
              <div className="mt-8">
                <Link
                  href="/smart-wallets"
                  className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-all hover:bg-blue-700"
                >
                  Open your wallet
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
              </div>
            </FadeIn>
          </div>
        </div>
        </ScrollExpandSection>
      </div>

      {/* ─────────────────────────────────────────────────── */}
      {/* SECTION 3: DEVELOPERS / DOCS                        */}
      {/* ─────────────────────────────────────────────────── */}
      <div id="developers-section">
        <ScrollExpandSection
          videoSrc="/Stablecoin_Image_To_Video_Generation.mp4"
          overlayClassName="bg-gradient-to-t from-black/90 via-black/60 to-black/80"
        >
        <div className="mx-auto w-full max-w-6xl px-6 lg:px-12">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <FadeIn>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-zinc-400 backdrop-blur-xl">
                Developer Portal
              </div>
              <h2 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
                Build the future of
                <br />
                African fintech.
              </h2>
              <p className="mt-6 text-base leading-relaxed text-zinc-300 sm:text-lg">
                Integrate nTZS into your application in minutes. Our Wallet as
                a Service API lets you provision wallets, move money, and build
                financial products with simple REST calls. Full documentation,
                SDKs, and sandbox testing included.
              </p>

              {/* Code preview card */}
              <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl">
                <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
                  <span className="ml-2 text-[10px] text-zinc-600">create-wallet.ts</span>
                </div>
                <pre className="overflow-x-auto p-4 text-xs leading-relaxed">
                  <code>
                    <span className="text-purple-400">const</span>{' '}
                    <span className="text-blue-300">wallet</span>{' '}
                    <span className="text-white">=</span>{' '}
                    <span className="text-purple-400">await</span>{' '}
                    <span className="text-yellow-300">fetch</span>
                    <span className="text-white">(</span>
                    <span className="text-green-400">&quot;/api/v1/users&quot;</span>
                    <span className="text-white">, {'{'}</span>
                    {'\n'}
                    {'  '}
                    <span className="text-blue-300">method</span>
                    <span className="text-white">:</span>{' '}
                    <span className="text-green-400">&quot;POST&quot;</span>
                    <span className="text-white">,</span>
                    {'\n'}
                    {'  '}
                    <span className="text-blue-300">body</span>
                    <span className="text-white">:</span>{' '}
                    <span className="text-yellow-300">JSON</span>
                    <span className="text-white">.</span>
                    <span className="text-yellow-300">stringify</span>
                    <span className="text-white">({'{'}</span>
                    {'\n'}
                    {'    '}
                    <span className="text-blue-300">email</span>
                    <span className="text-white">:</span>{' '}
                    <span className="text-green-400">&quot;user@example.com&quot;</span>
                    {'\n'}
                    {'  '}
                    <span className="text-white">{'}'})</span>
                    {'\n'}
                    <span className="text-white">{'}'})</span>
                  </code>
                </pre>
              </div>

              <div className="mt-8">
                <Link
                  href="/developers"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-medium text-white backdrop-blur-xl transition-all hover:bg-white/20"
                >
                  View developer docs
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
              </div>
            </FadeIn>

            <FadeIn delay={0.2}>
              <div className="hidden md:block" />
            </FadeIn>
          </div>
        </div>
        </ScrollExpandSection>
      </div>

      {/* ─────────────────────────────────────────────────── */}
      {/* SECTION 4: APP / DASHBOARD                          */}
      {/* ─────────────────────────────────────────────────── */}
      <div id="app-section">
        <ScrollExpandSection
          videoSrc="/BG.mp4"
          overlayClassName="bg-gradient-to-t from-black/90 via-black/40 to-black/60"
        >
        <div className="mx-auto w-full max-w-4xl px-6 text-center lg:px-12">
          <FadeIn>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-zinc-400 backdrop-blur-xl">
              Launch App
            </div>
            <h2 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
              Ready to move money
              <br />
              at the speed of the internet?
            </h2>
            <p className="mt-6 text-base leading-relaxed text-zinc-300 sm:text-lg">
              Create your account, deposit via mobile money, and start
              transacting in under 2 minutes. The nTZS dashboard puts
              you in full control of your digital finances.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/app"
                className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:bg-blue-700 hover:shadow-blue-600/40"
              >
                Launch App
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <Link
                href="/auth/sign-up"
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-8 py-3.5 text-sm font-medium text-white backdrop-blur-xl transition-all hover:bg-white/20"
              >
                Create Account
              </Link>
            </div>
          </FadeIn>
        </div>
        </ScrollExpandSection>
      </div>
    </div>
  )
}
