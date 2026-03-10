'use client'

import Image from 'next/image'
import Link from 'next/link'

import LandingSections from './LandingSections'
import { CodeRevealText } from '@/components/CodeRevealText'

export default function MasterLandingPage() {
  return (
    <div className="bg-black font-mono text-white">
      {/* ── Hero ── */}
      <section className="relative min-h-screen overflow-hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        >
          <source src="/HERO VIDEO.mp4" type="video/mp4" />
        </video>

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/80 via-black/70 to-black/95" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center_top,rgba(59,130,246,0.2),transparent_55%)]" />

        <div className="relative z-10 flex min-h-screen flex-col">
          <header className="pointer-events-auto relative z-50 flex items-center justify-between px-6 py-6 lg:px-12">
            <div className="flex items-center gap-3">
              <Image src="/ntzs-logo.png" alt="nTZS" width={40} height={40} className="rounded-xl" />
              <span className="text-lg font-bold tracking-tight">nTZS</span>
            </div>
            
            <nav className="hidden md:flex items-center gap-6 text-sm text-white/70">
              <button
                onClick={() => {
                  const section = document.getElementById('about-section')
                  section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className="hover:text-white transition-colors"
              >
                About
              </button>
              <button
                onClick={() => {
                  const section = document.getElementById('wallet-section')
                  section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className="hover:text-white transition-colors"
              >
                Wallet
              </button>
              <button
                onClick={() => {
                  const section = document.getElementById('developers-section')
                  section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className="hover:text-white transition-colors"
              >
                Developers
              </button>
              <Link
                href="/app"
                className="rounded-full border border-white/20 bg-white/10 px-5 py-2 font-medium backdrop-blur-xl transition-colors hover:bg-white/20"
              >
                Launch App
              </Link>
            </nav>
            
            <Link
              href="/app"
              className="md:hidden rounded-full border border-white/20 bg-white/10 px-5 py-2 text-sm font-medium backdrop-blur-xl transition-colors hover:bg-white/20"
            >
              Launch App
            </Link>
          </header>

          <main className="pointer-events-auto flex flex-1 flex-col items-center justify-center px-6 text-center">
            <h1 className="max-w-4xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
              The Smart Payment Infrastructure
            </h1>
            <h2 className="mt-3 max-w-3xl text-2xl font-light text-white sm:text-3xl lg:text-4xl">
              for Africa&apos;s Digital Economy
            </h2>

            <p className="mt-8 max-w-xl text-base leading-relaxed text-zinc-300 sm:text-lg font-mono">
              <CodeRevealText text="Issue wallets. Move money, Build financial products." />
              <br />
              <CodeRevealText text="Powered by nTZS." />
            </p>

            {/* CTA Buttons */}
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
              <Link
                href="/app"
                className="inline-flex items-center justify-center rounded-md border border-white/30 bg-white/10 px-8 py-3 text-sm font-medium text-white backdrop-blur-xl transition-all hover:bg-white/20"
              >
                Create Wallet
              </Link>
              <Link
                href="/landing"
                className="inline-flex items-center justify-center rounded-md border border-white/30 bg-transparent px-8 py-3 text-sm font-medium text-white transition-all hover:bg-white/10"
              >
                Explore Infrastructure
              </Link>
            </div>

            {/* Scroll indicator */}
            <div className="mt-16 flex flex-col items-center gap-2 text-zinc-500">
              <p className="text-xs tracking-widest uppercase">Scroll to explore</p>
              <svg className="h-5 w-5 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
              </svg>
            </div>
          </main>
        </div>
      </section>

      {/* ── Animated Sections ── */}
      <LandingSections />

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 px-6 py-8 text-center text-xs text-zinc-600 lg:px-12">
        <p>&copy; {new Date().getFullYear()} nTZS -- Secure digital payments for Tanzania</p>
      </footer>
    </div>
  )
}

