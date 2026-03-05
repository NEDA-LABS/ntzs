import Image from 'next/image'
import Link from 'next/link'

export default function MasterLandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* ── Video Background ── */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      >
        <source src="/HERO.mp4" type="video/mp4" />
      </video>

      {/* Gradient overlay for readability */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/80 via-black/70 to-black/95" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center_top,rgba(59,130,246,0.2),transparent_55%)]" />

      {/* ── Content ── */}
      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-6 lg:px-12">
          <div className="flex items-center gap-3">
            <Image src="/ntzs-logo.png" alt="nTZS" width={40} height={40} className="rounded-xl" />
            <span className="text-lg font-bold tracking-tight">nTZS</span>
          </div>
          <Link
            href="/app"
            className="rounded-full border border-white/20 bg-white/10 px-5 py-2 text-sm font-medium backdrop-blur-xl transition-colors hover:bg-white/20"
          >
            Launch App
          </Link>
        </header>

        {/* Hero */}
        <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-1.5 text-xs font-medium text-blue-300 backdrop-blur-xl">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            Coming Soon
          </div>

          <h1 className="max-w-3xl text-5xl font-bold leading-[1.1] tracking-tight sm:text-6xl lg:text-7xl">
            nTZS Smart
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-cyan-300 to-blue-500 bg-clip-text text-transparent">
              Wallet
            </span>
          </h1>

          <p className="mt-6 max-w-lg text-base leading-relaxed text-zinc-400 sm:text-lg">
            Connect all your digital payments. One wallet for mobile money, stablecoins, and instant transfers.
          </p>

          {/* ── Glass Navigation Buttons ── */}
          <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5">
            <GlassNavButton
              href="/landing"
              icon={
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 003 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
              }
              label="About"
            />
            <GlassNavButton
              href="/app/user/wallet"
              icon={
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 110-6h5.25A2.25 2.25 0 0121 6v6zm0 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18V6a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 6m-7.5 6a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
              }
              label="Wallet"
            />
            <GlassNavButton
              href="/developers"
              icon={
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              }
              label="Docs"
            />
            <GlassNavButton
              href="/app"
              icon={
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008V17.25zm-6.75 0h.008v.008h-.008V17.25zm6.75-3h.008v.008H15V14.25z" />
                </svg>
              }
              label="App"
            />
          </div>
        </main>

        {/* ── Tagline Strip ── */}
        <section className="px-6 pb-16 lg:px-12">
          <div className="mx-auto max-w-4xl text-right">
            <p className="text-2xl font-light tracking-tight text-white/40 sm:text-3xl lg:text-4xl">
              nTZS Smart Wallet
            </p>
            <p className="mt-2 text-sm font-medium tracking-widest uppercase text-blue-400/70">
              Coming Soon
            </p>
            <p className="mt-1 text-xs tracking-wider text-zinc-600">ntzs.co.tz</p>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-white/5 px-6 py-6 text-center text-xs text-zinc-600 lg:px-12">
          <p>&copy; {new Date().getFullYear()} nTZS &mdash; Secure digital payments for Tanzania</p>
        </footer>
      </div>
    </div>
  )
}

function GlassNavButton({
  href,
  icon,
  label,
}: {
  href: string
  icon: React.ReactNode
  label: string
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col items-center gap-3 rounded-2xl border border-white/[0.12] bg-white/[0.06] px-6 py-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1),0_4px_24px_rgba(0,0,0,0.3)] backdrop-blur-2xl transition-all duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.1] hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15),0_8px_32px_rgba(0,0,0,0.4)] active:scale-95 sm:px-8"
    >
      {/* Glass shine */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/10 to-transparent opacity-50" />
      <div className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-white/5 opacity-0 transition-opacity group-hover:opacity-100" />

      <div className="relative text-white/80 transition-colors group-hover:text-white">
        {icon}
      </div>
      <span className="relative text-xs font-semibold tracking-wide text-white/70 transition-colors group-hover:text-white">
        {label}
      </span>
    </Link>
  )
}

