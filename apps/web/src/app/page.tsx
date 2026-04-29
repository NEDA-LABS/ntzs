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

        {/* Video background */}
        <video
          autoPlay loop muted playsInline preload="auto"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        >
          <source src="/HERO VIDEO.mp4" type="video/mp4" />
        </video>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/80 via-black/65 to-black/95" />

        {/* Corner frame accents */}
        <div className="pointer-events-none absolute top-0 left-0 w-12 h-12 border-t border-l border-white/25 z-20" />
        <div className="pointer-events-none absolute top-0 right-0 w-12 h-12 border-t border-r border-white/25 z-20" />
        <div className="pointer-events-none absolute bottom-0 left-0 w-12 h-12 border-b border-l border-white/25 z-20" />
        <div className="pointer-events-none absolute bottom-0 right-0 w-12 h-12 border-b border-r border-white/25 z-20" />

        {/* ── Top nav bar ── */}
        <header className="relative z-50 border-b border-white/10 bg-black/30 backdrop-blur-sm">
          <div className="flex items-center justify-between px-6 py-3 lg:px-12">

            {/* Logo */}
            <div className="flex items-center gap-3">
              <Image src="/ntzs-logo.png" alt="nTZS" width={28} height={28} className="rounded-md opacity-90" />
              <span className="text-base font-bold tracking-widest uppercase">
                n<span className="text-emerald-400">TZS</span>
              </span>
              <div className="hidden lg:flex items-center gap-2 ml-3 pl-3 border-l border-white/10">
                <span className="text-[9px] tracking-widest text-white/30 uppercase">Tanzania Shilling Network</span>
              </div>
            </div>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1 text-[10px] tracking-widest uppercase">
              {[
                { label: 'About', id: 'about-section' },
                { label: 'Wallet', id: 'wallet-section' },
                { label: 'Developers', id: 'developers-section' },
              ].map(({ label, id }) => (
                <button
                  key={id}
                  onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="px-4 py-2 text-white/40 hover:text-white/80 hover:bg-white/[0.04] transition-colors"
                >
                  {label}
                </button>
              ))}
              <div className="w-px h-4 bg-white/10 mx-1" />
              <Link
                href="/merchant"
                className="px-4 py-2 border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              >
                Biashara
              </Link>
              <Link
                href={process.env.NEXT_PUBLIC_FX_URL ?? 'http://localhost:3001'}
                className="px-4 py-2 border border-white/15 text-white/50 hover:bg-white/[0.04] hover:text-white/80 transition-colors"
              >
                SimpleFX
              </Link>
            </nav>

            {/* Mobile nav */}
            <div className="md:hidden flex items-center gap-1.5">
              <Link
                href="/merchant"
                className="px-3 py-1.5 border border-emerald-500/30 bg-emerald-500/10 text-[10px] tracking-widest text-emerald-400 uppercase"
              >
                Biashara
              </Link>
              <Link
                href={process.env.NEXT_PUBLIC_FX_URL ?? 'http://localhost:3001'}
                className="px-3 py-1.5 border border-white/15 text-[10px] tracking-widest text-white/50 uppercase"
              >
                SimpleFX
              </Link>
            </div>
          </div>

          {/* Metadata strip — desktop only */}
          <div className="hidden lg:flex items-center justify-between border-t border-white/5 px-12 py-1.5">
            <div className="flex items-center gap-4 text-[9px] tracking-widest text-white/20 uppercase">
              <span>LAT: -6.7924°</span>
              <div className="w-px h-2.5 bg-white/10" />
              <span>LONG: 39.2083°</span>
              <div className="w-px h-2.5 bg-white/10" />
              <span>Dar es Salaam, Tanzania</span>
            </div>
            <div className="flex items-center gap-4 text-[9px] tracking-widest text-white/20 uppercase">
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                <span>Base Mainnet</span>
              </div>
              <div className="w-px h-2.5 bg-white/10" />
              <span>V1.0.0</span>
            </div>
          </div>
        </header>

        {/* ── Hero content ── */}
        <div className="relative z-10 flex min-h-[calc(100vh-theme(spacing.20))] flex-col">
          <main className="flex flex-1 flex-col justify-center px-6 lg:px-16 lg:ml-[6%] pt-8 lg:pt-0">
            <div className="max-w-xl">

              {/* Section label */}
              <div className="flex items-center gap-2 mb-4 opacity-60">
                <div className="w-6 h-px bg-emerald-400" />
                <span className="text-[9px] tracking-widest text-emerald-400 uppercase">001 / Digital Reserve</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              {/* Main headline */}
              <div className="relative">
                <div className="hidden lg:block absolute -left-4 top-0 bottom-0 w-px"
                  style={{
                    background: 'repeating-linear-gradient(180deg, rgba(74,222,128,0.4) 0px, rgba(74,222,128,0.4) 2px, transparent 2px, transparent 5px)'
                  }}
                />
                <h1 className="text-3xl lg:text-6xl font-bold text-white leading-tight tracking-wider uppercase">
                  Tanzania&apos;s
                  <span className="block text-emerald-400 mt-1">
                    Digital Shilling
                  </span>
                </h1>
              </div>

              {/* Decorative dot row */}
              <div className="flex gap-0.5 my-4 opacity-30">
                {Array.from({ length: 48 }).map((_, i) => (
                  <div key={i} className="w-0.5 h-0.5 bg-white rounded-full" />
                ))}
              </div>

              {/* Description */}
              <p className="text-sm lg:text-base text-zinc-300 mb-6 leading-relaxed opacity-80">
                <CodeRevealText text="Issue wallets. Move money. Build financial products." />
                <br />
                <CodeRevealText text="Powered by nTZS — backed 1:1 by regulated deposits." />
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/app"
                  className="relative inline-flex items-center justify-center border border-emerald-500/50 bg-emerald-500/10 px-6 py-2.5 text-[11px] tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 transition-colors group"
                >
                  <span className="absolute -top-px -left-px w-2 h-2 border-t border-l border-emerald-400/60 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <span className="absolute -bottom-px -right-px w-2 h-2 border-b border-r border-emerald-400/60 opacity-0 group-hover:opacity-100 transition-opacity" />
                  Create Wallet
                </Link>
                <Link
                  href="/landing"
                  className="inline-flex items-center justify-center border border-white/15 px-6 py-2.5 text-[11px] tracking-widest text-white/50 uppercase hover:bg-white/[0.04] hover:text-white/80 transition-colors"
                >
                  Explore Infrastructure
                </Link>
              </div>

              {/* Technical notation */}
              <div className="hidden lg:flex items-center gap-2 mt-8 opacity-30">
                <span className="text-[9px] text-white">∞</span>
                <div className="flex-1 h-px bg-white/20" />
                <span className="text-[9px] tracking-widest text-white uppercase">nTZS Network · ERC-20 · Base L2</span>
              </div>
            </div>
          </main>

          {/* Scroll indicator */}
          <div className="flex flex-col items-center gap-2 pb-8 text-white/20">
            <span className="text-[9px] tracking-widest uppercase">Scroll</span>
            <div className="flex flex-col gap-1">
              <div className="w-px h-3 bg-white/20 mx-auto" />
              <div className="w-px h-2 bg-white/10 mx-auto" />
            </div>
          </div>
        </div>

        {/* Status bar — bottom of hero */}
        <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-white/8 bg-black/40 backdrop-blur-sm px-6 lg:px-12 py-2 flex items-center justify-between">
          <div className="flex items-center gap-4 text-[9px] tracking-widest text-white/25 uppercase">
            <span className="hidden lg:inline">System.Active</span>
            <div className="hidden lg:flex gap-1 items-end h-3">
              {[4,7,3,9,5,8,4,6].map((h, i) => (
                <div key={i} className="w-0.5 bg-white/20" style={{ height: `${h}px` }} />
              ))}
            </div>
            <span>1:1 TZS Backed</span>
          </div>
          <div className="flex items-center gap-3 text-[9px] tracking-widest text-white/25 uppercase">
            <span className="hidden lg:inline">◐ Rendering</span>
            <div className="flex gap-1">
              {[0, 0.15, 0.3].map((d, i) => (
                <div key={i} className="w-1 h-1 rounded-full bg-emerald-400/40 animate-pulse" style={{ animationDelay: `${d}s` }} />
              ))}
            </div>
            <span className="hidden lg:inline">Secure · Instant · Regulated</span>
          </div>
        </div>
      </section>

      {/* ── Animated Sections ── */}
      <LandingSections />

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 px-6 lg:px-12">
        <div className="flex items-center justify-between py-6">
          <div className="flex items-center gap-3">
            <span className="text-base font-bold tracking-widest uppercase">
              n<span className="text-emerald-400">TZS</span>
            </span>
            <div className="w-px h-3 bg-white/10" />
            <span className="text-[9px] tracking-widest text-white/20 uppercase">Tanzania Shilling Stablecoin</span>
          </div>
          <p className="text-[9px] tracking-widest text-white/20 uppercase">
            &copy; {new Date().getFullYear()} · Secure Digital Payments for Tanzania
          </p>
        </div>
      </footer>
    </div>
  )
}
