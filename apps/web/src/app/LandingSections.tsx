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
      {/* SECTION 1: WALLET                                   */}
      {/* ─────────────────────────────────────────────────── */}
      <div id="wallet-section">
        <ScrollExpandSection
          videoSrc="/ntzs_demo.mp4"
          videoEndTime={6}
          overlayClassName="bg-gradient-to-t from-black/90 via-black/50 to-black/70"
        >
        <div className="mx-auto w-full max-w-6xl px-6 lg:px-12">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <FadeIn className="order-2 md:order-1">
              <div className="hidden md:block" />
            </FadeIn>

            <FadeIn delay={0.1} className="order-1 md:order-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-4 h-px bg-blue-400/60" />
                <span className="text-[9px] tracking-widest text-blue-400/60 uppercase">002 / Wallet</span>
              </div>
              <h2 className="text-3xl font-bold leading-tight tracking-wider text-white uppercase sm:text-4xl lg:text-5xl">
                One Wallet.
                <br />
                Infinite Possibilities.
              </h2>
              <p className="mt-6 text-sm leading-relaxed text-zinc-300 font-mono">
                Deposit via mobile money, hold digital TZS, send to anyone
                instantly. No bank account required, no hidden fees, no waiting.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-2">
                {[
                  { value: '0s', label: 'Settlement time' },
                  { value: '24/7', label: 'Always available' },
                  { value: '0%', label: 'Transfer fees' },
                  { value: '1:1', label: 'TZS backed' },
                ].map(({ value, label }) => (
                  <div key={label} className="border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-2xl font-bold text-white tracking-wider">{value}</div>
                    <div className="mt-1 text-[9px] tracking-widest text-white/30 uppercase">{label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-8">
                <Link
                  href="/smart-wallets"
                  className="inline-flex items-center gap-2 border border-blue-500/30 bg-blue-500/10 px-6 py-2.5 text-[10px] tracking-widest text-blue-400 uppercase hover:bg-blue-500/20 transition-colors"
                >
                  Open your wallet
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
      {/* SECTION 2: ABOUT                                    */}
      {/* ─────────────────────────────────────────────────── */}
      <div id="about-section">
        <ScrollExpandSection
          videoSrc="/Stablecoin_Image_To_Video_Generation.mp4"
          overlayClassName="bg-gradient-to-t from-black/90 via-black/60 to-black/80"
        >
        <div className="mx-auto w-full max-w-6xl px-6 lg:px-12">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-4 h-px bg-blue-400/60" />
                <span className="text-[9px] tracking-widest text-blue-400/60 uppercase">003 / About</span>
              </div>
              <h2 className="text-3xl font-bold leading-tight tracking-wider text-white uppercase sm:text-4xl lg:text-5xl">
                Tanzania&apos;s First
                <br />
                Digital Reserve.
              </h2>
              <p className="mt-6 text-sm leading-relaxed text-zinc-300 font-mono">
                Real money. Instant movement.
                <br />
                nTZS is programmable Tanzanian Shillings — backed 1:1 by regulated deposits, settled in real time, secured on-chain.
              </p>
              <div className="mt-8">
                <Link
                  href="/landing"
                  className="inline-flex items-center gap-2 border border-white/15 px-6 py-2.5 text-[10px] tracking-widest text-white/60 uppercase hover:bg-white/[0.04] hover:text-white/90 transition-colors"
                >
                  Learn more about nTZS
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
      {/* SECTION 3: DEVELOPERS / DOCS                        */}
      {/* ─────────────────────────────────────────────────── */}
      <div id="developers-section">
        <ScrollExpandSection
          videoSrc="/HERO VIDEO.mp4"
          overlayClassName="bg-gradient-to-t from-black/90 via-black/60 to-black/80"
        >
        <div className="mx-auto w-full max-w-6xl px-6 lg:px-12">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <FadeIn>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-4 h-px bg-blue-400/60" />
                <span className="text-[9px] tracking-widest text-blue-400/60 uppercase">004 / Developers</span>
              </div>
              <h2 className="text-3xl font-bold leading-tight tracking-wider text-white uppercase sm:text-4xl lg:text-5xl">
                The Future of
                <br />
                Africa Fintech.
              </h2>
              <p className="mt-6 text-sm leading-relaxed text-zinc-300 font-mono">
                Integrate nTZS into your application in minutes. Our Wallet as
                a Service API lets you provision wallets, move money, and build
                financial products with simple REST calls.
              </p>

              {/* Code preview card */}
              <div className="mt-6 overflow-hidden border border-white/8 bg-black/60 backdrop-blur-xl">
                <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5 bg-white/[0.02]">
                  <div className="w-4 h-px bg-blue-400/40" />
                  <span className="text-[9px] tracking-widest text-white/25 uppercase">create-wallet.ts</span>
                  <div className="flex-1 h-px bg-white/5" />
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400/60 animate-pulse" />
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
                  className="inline-flex items-center gap-2 border border-white/15 px-6 py-2.5 text-[10px] tracking-widest text-white/60 uppercase hover:bg-white/[0.04] hover:text-white/90 transition-colors"
                >
                  View developer docs
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
            <div className="flex items-center justify-center gap-2 mb-6">
              <div className="w-6 h-px bg-blue-400/40" />
              <span className="text-[9px] tracking-widest text-blue-400/40 uppercase">005 / Get Started</span>
              <div className="w-6 h-px bg-blue-400/40" />
            </div>
            <h2 className="text-3xl font-bold leading-tight tracking-wider text-white uppercase sm:text-4xl lg:text-5xl">
              Ready to Move Money
              <br />
              at Internet Speed?
            </h2>
            <p className="mt-6 text-sm leading-relaxed text-zinc-300 font-mono">
              Create your account, deposit via mobile money, and start
              transacting in under 2 minutes.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/app"
                className="relative inline-flex items-center gap-2 border border-blue-500/40 bg-blue-500/10 px-8 py-3 text-[11px] tracking-widest text-blue-400 uppercase hover:bg-blue-500/20 transition-colors group"
              >
                <span className="absolute -top-px -left-px w-2.5 h-2.5 border-t border-l border-blue-400/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="absolute -bottom-px -right-px w-2.5 h-2.5 border-b border-r border-blue-400/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                Launch App
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <Link
                href="/auth/sign-up"
                className="inline-flex items-center gap-2 border border-white/15 px-8 py-3 text-[11px] tracking-widest text-white/50 uppercase hover:bg-white/[0.04] hover:text-white/80 transition-colors"
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
