'use client'

import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useScroll, motion } from 'framer-motion'
import { ChevronRight, Menu, X } from 'lucide-react'

import { InfiniteSlider } from '@/components/ui/infinite-slider'
import { ProgressiveBlur } from '@/components/ui/progressive-blur'
import { cn } from '@/lib/utils'

const navLinks = [
  { name: 'Digital Reserve', href: '/' },
  { name: 'Smart Wallets', href: '/smart-wallets' },
  { name: 'Developers', href: '/developers' },
]

const partners = [
  'Vodacom',
  'Equity Bank',
  'M-Pesa',
  'Airtel Money',
  'CRDB Bank',
  'NMB Bank',
  'Stanbic',
  'Standard Chartered',
  'Selcom',
  'Azam Pay',
]

function ScrollNav() {
  const [open, setOpen] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)
  const { scrollYProgress } = useScroll()

  React.useEffect(() => {
    const unsub = scrollYProgress.on('change', (v) => setScrolled(v > 0.03))
    return () => unsub()
  }, [scrollYProgress])

  return (
    <header className="fixed top-0 z-30 w-full pt-2">
      <nav
        data-state={open ? 'active' : undefined}
        className="group mx-auto max-w-7xl px-6 lg:px-12"
      >
        <div
          className={cn(
            'mx-auto rounded-2xl px-5 py-3 transition-all duration-300',
            scrolled ? 'bg-black/60 backdrop-blur-xl' : 'bg-transparent',
          )}
        >
          <div className="flex items-center justify-between">
            {/* Brand */}
            <Link href="/" className="flex items-center gap-2.5">
              <div className="overflow-hidden rounded-full">
                <Image src="/ntzs-logo.png" alt="nTZS" width={32} height={32} />
              </div>
              <span className="text-sm font-semibold text-white">nTZS</span>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden items-center gap-7 text-sm md:flex">
              {navLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    'transition-colors hover:text-white',
                    l.href === '/smart-wallets'
                      ? 'font-medium text-white'
                      : 'text-white/60',
                  )}
                >
                  {l.name}
                </Link>
              ))}
            </nav>

            {/* Desktop CTA */}
            <div className="hidden items-center gap-3 md:flex">
              <Link
                href="/developers/login"
                className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-white/80 backdrop-blur-lg transition hover:bg-white/10"
              >
                Partner Login
              </Link>
              <Link
                href="/developers/signup"
                className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-white/90"
              >
                Get API Key
              </Link>
            </div>

            {/* Mobile menu toggle */}
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="relative z-20 -mr-1 block p-2 text-white md:hidden"
            >
              <Menu
                className={cn(
                  'h-5 w-5 transition-all duration-200',
                  open ? 'scale-0 opacity-0' : 'scale-100 opacity-100',
                )}
              />
              <X
                className={cn(
                  'absolute inset-0 m-auto h-5 w-5 transition-all duration-200',
                  open ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
                )}
              />
            </button>
          </div>

          {/* Mobile menu */}
          {open && (
            <div className="mt-4 flex flex-col gap-4 border-t border-white/10 pt-4 pb-2 md:hidden">
              {navLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="text-sm text-white/70 hover:text-white"
                >
                  {l.name}
                </Link>
              ))}
              <div className="flex flex-col gap-2 pt-2">
                <Link
                  href="/developers/login"
                  className="rounded-full border border-white/15 py-2 text-center text-sm text-white/80"
                >
                  Partner Login
                </Link>
                <Link
                  href="/developers/signup"
                  className="rounded-full bg-white py-2 text-center text-sm font-semibold text-black"
                >
                  Get API Key
                </Link>
              </div>
            </div>
          )}
        </div>
      </nav>
    </header>
  )
}

export function SmartWalletsHero() {
  return (
    <>
      <ScrollNav />

      <main className="overflow-x-hidden bg-black text-white">
        {/* ── Hero section ─────────────────────────────────── */}
        <section className="relative">
          {/* Video background */}
          <div className="absolute inset-0 overflow-hidden rounded-b-3xl">
            <video
              autoPlay
              loop
              muted
              playsInline
              className="size-full object-cover opacity-40"
              src="/BG.mp4"
            />
            {/* Gradient vignette so text stays readable */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/80" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
          </div>

          {/* Content */}
          <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col justify-center px-6 pb-32 pt-40 lg:px-12">
            <div className="max-w-2xl">
              {/* Badge */}
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-200 backdrop-blur-md">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                Wallet as a Service (WaaS)
              </div>

              {/* Headline */}
              <h1 className="whitespace-nowrap text-4xl font-extralight leading-[1.12] tracking-tight text-white md:text-6xl xl:text-7xl">
                Build 10x Faster with nTZS
              </h1>

              <p className="mt-8 max-w-xl text-base leading-7 text-white/50 md:text-lg md:leading-8">
                Highly customizable infrastructure for building modern fintech applications with embedded wallets and mobile money.
              </p>

              {/* CTAs */}
              <div className="mt-10 flex items-center gap-6">
                <Link
                  href="/developers/signup"
                  className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-sm font-medium text-black transition hover:bg-white/90 active:scale-[0.98]"
                >
                  Start Building
                  <ChevronRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/developers"
                  className="text-sm text-white/70 transition hover:text-white"
                >
                  Request a demo
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── Partners slider ───────────────────────────────── */}
        <section className="border-t border-white/[0.07] bg-black py-2">
          <div className="mx-auto max-w-7xl px-6 lg:px-12">
            <div className="flex flex-col items-center gap-6 md:flex-row">
              {/* Label */}
              <div className="shrink-0 md:w-44 md:border-r md:border-white/10 md:pr-6">
                <p className="text-right text-xs font-medium text-white/40">
                  Powering the best teams
                </p>
              </div>

              {/* Slider */}
              <div className="relative w-full py-6 md:w-[calc(100%-11rem)]">
                <InfiniteSlider speedOnHover={20} speed={40} gap={48}>
                  {partners.map((name) => (
                    <div
                      key={name}
                      className="flex items-center gap-12"
                    >
                      <span className="whitespace-nowrap text-sm font-semibold tracking-wide text-white/30">
                        {name}
                      </span>
                      <Image
                        src="/ntzs-icon.svg"
                        alt="nTZS"
                        width={18}
                        height={18}
                        className="opacity-20 shrink-0"
                      />
                    </div>
                  ))}
                </InfiniteSlider>

                <ProgressiveBlur
                  className="pointer-events-none absolute left-0 top-0 h-full w-24"
                  direction="left"
                  blurIntensity={1}
                />
                <ProgressiveBlur
                  className="pointer-events-none absolute right-0 top-0 h-full w-24"
                  direction="right"
                  blurIntensity={1}
                />
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}
