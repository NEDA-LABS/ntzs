import type { ReactNode } from 'react'

import Image from 'next/image'
import Link from 'next/link'

function GlassCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.05)] backdrop-blur-xl">
      <div className="absolute -left-24 -top-24 h-56 w-56 rounded-full bg-white/5 blur-3xl transition-opacity group-hover:opacity-80" />
      <div className="relative">
        <div className="text-sm font-medium text-white/70">{title}</div>
        <div className="mt-2 text-base leading-6 text-white/90">{description}</div>
      </div>
    </div>
  )
}

function FeatureCard3D({
  step,
  title,
  description,
  icon,
  featured,
}: {
  step: string
  title: string
  description: string
  icon: ReactNode
  featured?: boolean
}) {
  return (
    <article
      className={`group relative overflow-hidden rounded-[28px] border bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl transition-transform duration-300 will-change-transform hover:-translate-y-1 hover:scale-[1.01] md:p-7 ${
        featured
          ? 'border-white/20 ring-1 ring-white/10 md:-translate-y-2 md:scale-[1.03]'
          : 'border-white/10'
      }`}
    >
      <div className="pointer-events-none absolute inset-0 opacity-90">
        <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -right-32 -bottom-32 h-72 w-72 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(99,102,241,0.18),transparent_40%),radial-gradient(circle_at_70%_25%,rgba(236,72,153,0.16),transparent_45%),radial-gradient(circle_at_50%_85%,rgba(16,185,129,0.12),transparent_45%)]" />
      </div>

      <div className="relative">
        <div className="text-xs font-medium text-white/55">{step}</div>

        <div className="mt-5 ntzs-tilt-3d rounded-2xl border border-white/10 bg-black/20 p-5">
          <div className="ntzs-float-3d mx-auto flex h-28 w-full items-center justify-center">
            <div className="relative">
              <div className="pointer-events-none absolute -inset-8 rounded-full bg-white/10 blur-2xl" />
              <div className="relative">{icon}</div>
            </div>
          </div>
        </div>

        <h3 className="mt-5 text-lg font-semibold tracking-tight md:text-xl">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-white/70">{description}</p>
      </div>
    </article>
  )
}

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(121,40,202,0.25),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(0,112,243,0.25),transparent_45%),radial-gradient(circle_at_45%_90%,rgba(16,185,129,0.18),transparent_45%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <div className="pointer-events-none absolute inset-0">
        <video
          className="h-full w-full object-cover opacity-35"
          autoPlay
          muted
          playsInline
          loop
          preload="auto"
        >
          <source src="/Fintech_Video_With_NTZS_Logo.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/70 to-black" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="overflow-hidden rounded-full">
            <Image src="/ntzs-logo.png" alt="nTZS" width={34} height={34} />
          </div>
          <div className="text-sm font-semibold tracking-wide">nTZS</div>
        </div>

        <nav className="hidden items-center gap-6 text-sm text-white/70 md:flex">
          <a className="hover:text-white" href="#how-it-works">
            How it works
          </a>
          <Link className="hover:text-white" href="/smart-wallets">
            Smart Wallets
          </Link>
          <a className="hover:text-white" href="#oversight">
            Oversight
          </a>
          <Link className="hover:text-white" href="/developers">
            Developers
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <a
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 backdrop-blur-lg transition-colors hover:bg-white/10"
            href="/auth/sign-in"
          >
            Log in
          </a>
          <a
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white/90"
            href="/auth/sign-up"
          >
            Get started
          </a>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24 pt-8">
        <section className="grid items-center gap-10 md:grid-cols-2 md:gap-12">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 backdrop-blur-lg">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Next-generation financial infrastructure
            </div>

            <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              Tanzania's first digital asset reserve.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-7 text-white/70 md:text-lg">
              Transform traditional bank deposits into instant, programmable balances. Build automated
              payment flows, real-time marketplaces, and modern financial products with zero friction.
            </p>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-white/10 via-white/0 to-white/10 blur-2xl" />
            <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl">
              <div className="aspect-[4/3]">
                <video
                  className="h-full w-full object-cover"
                  autoPlay
                  muted
                  playsInline
                  loop
                  preload="auto"
                >
                  <source src="/Stablecoin_Image_To_Video_Generation.mp4" type="video/mp4" />
                </video>
              </div>

              <div className="grid gap-4 p-6">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Start Here</div>
                  <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                    Get started
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Link
                    href="/auth/sign-up"
                    className="inline-flex h-14 items-center justify-center rounded-full bg-white px-8 text-base font-semibold text-black transition-colors hover:bg-white/90"
                  >
                    Create account
                  </Link>
                  <a
                    href="/app"
                    className="inline-flex h-14 items-center justify-center rounded-full border border-white/15 bg-white/5 px-8 text-base text-white/85 backdrop-blur-lg transition-colors hover:bg-white/10"
                  >
                    Go to dashboard
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mt-20">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                A unified engine for moving value
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70 md:text-base">
                Everything you need to onboard users, program business logic, and settle transactions instantly.
              </p>
            </div>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            <FeatureCard3D
              step="Step 1"
              title="Onboard instantly"
              description="Users convert local currency into digital balances instantly via mobile money or bank transfer, with fully automated reconciliation."
              icon={
                <svg
                  width="128"
                  height="96"
                  viewBox="0 0 128 96"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <linearGradient id="d1" x1="20" y1="18" x2="108" y2="86" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#A78BFA" />
                      <stop offset="0.55" stopColor="#60A5FA" />
                      <stop offset="1" stopColor="#34D399" />
                    </linearGradient>
                    <linearGradient id="d2" x1="34" y1="26" x2="98" y2="78" gradientUnits="userSpaceOnUse">
                      <stop stopColor="white" stopOpacity="0.9" />
                      <stop offset="1" stopColor="white" stopOpacity="0.25" />
                    </linearGradient>
                  </defs>
                  <g opacity="0.95">
                    <path
                      d="M33 58c0-6.6 13.9-12 31-12s31 5.4 31 12-13.9 12-31 12-31-5.4-31-12Z"
                      fill="url(#d1)"
                      fillOpacity="0.35"
                    />
                    <path
                      d="M38 56c0-4.6 11.6-8.5 26-8.5S90 51.4 90 56s-11.6 8.5-26 8.5S38 60.6 38 56Z"
                      fill="url(#d2)"
                    />
                    <path
                      d="M42 42c0-4.6 9.8-8.5 22-8.5S86 37.4 86 42s-9.8 8.5-22 8.5S42 46.6 42 42Z"
                      fill="url(#d1)"
                      fillOpacity="0.35"
                    />
                    <path
                      d="M46 40c0-3 8-5.5 18-5.5s18 2.5 18 5.5-8 5.5-18 5.5-18-2.5-18-5.5Z"
                      fill="url(#d2)"
                    />
                    <path
                      d="M64 18v18"
                      stroke="white"
                      strokeOpacity="0.85"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M56 28l8 8 8-8"
                      stroke="white"
                      strokeOpacity="0.85"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                </svg>
              }
            />

            <FeatureCard3D
              step="Step 2"
              title="Automate workflows"
              description="Embed custom business logic, enforce compliance rules, and build conditional payment flows directly into your application."
              featured
              icon={
                <svg
                  width="128"
                  height="96"
                  viewBox="0 0 128 96"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <linearGradient id="r1" x1="28" y1="12" x2="100" y2="88" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#60A5FA" />
                      <stop offset="0.55" stopColor="#A78BFA" />
                      <stop offset="1" stopColor="#F472B6" />
                    </linearGradient>
                    <linearGradient id="r2" x1="40" y1="22" x2="92" y2="80" gradientUnits="userSpaceOnUse">
                      <stop stopColor="white" stopOpacity="0.95" />
                      <stop offset="1" stopColor="white" stopOpacity="0.22" />
                    </linearGradient>
                  </defs>
                  <g opacity="0.95">
                    <path
                      d="M64 14c12 8 24 8 36 8v26c0 20-14.5 33.5-36 40-21.5-6.5-36-20-36-40V22c12 0 24 0 36-8Z"
                      fill="url(#r1)"
                      fillOpacity="0.28"
                      stroke="rgba(255,255,255,0.55)"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M64 22c9 6 18 6 27 6v18c0 14.5-10.2 24.6-27 29-16.8-4.4-27-14.5-27-29V28c9 0 18 0 27-6Z"
                      fill="url(#r2)"
                    />
                    <path
                      d="M52 49.5l8 8 18-18"
                      stroke="rgba(255,255,255,0.9)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                </svg>
              }
            />

            <FeatureCard3D
              step="Step 3"
              title="Settle in real-time"
              description="Move value anywhere instantly, 24/7. Finalize transactions across your platform without waiting for traditional banking hours."
              icon={
                <svg
                  width="128"
                  height="96"
                  viewBox="0 0 128 96"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <linearGradient id="s1" x1="24" y1="14" x2="108" y2="86" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#34D399" />
                      <stop offset="0.55" stopColor="#60A5FA" />
                      <stop offset="1" stopColor="#A78BFA" />
                    </linearGradient>
                    <linearGradient id="s2" x1="40" y1="22" x2="94" y2="80" gradientUnits="userSpaceOnUse">
                      <stop stopColor="white" stopOpacity="0.92" />
                      <stop offset="1" stopColor="white" stopOpacity="0.2" />
                    </linearGradient>
                  </defs>
                  <g opacity="0.95">
                    <path
                      d="M42 20h44c4.4 0 8 3.6 8 8v40c0 4.4-3.6 8-8 8H42c-4.4 0-8-3.6-8-8V28c0-4.4 3.6-8 8-8Z"
                      fill="url(#s1)"
                      fillOpacity="0.22"
                      stroke="rgba(255,255,255,0.55)"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M46 28h36c4.4 0 8 3.6 8 8v24c0 4.4-3.6 8-8 8H46c-4.4 0-8-3.6-8-8V36c0-4.4 3.6-8 8-8Z"
                      fill="url(#s2)"
                    />
                    <path
                      d="M78 18v18"
                      stroke="rgba(255,255,255,0.85)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M72 28l6 6 6-6"
                      stroke="rgba(255,255,255,0.85)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx="86" cy="20" r="6" fill="rgba(255,255,255,0.12)" />
                  </g>
                </svg>
              }
            />
          </div>
        </section>

        {/* WaaS Teaser Section */}
        <section className="mt-24 relative overflow-hidden rounded-[28px] border border-blue-500/20 bg-blue-500/5 p-8 md:p-12 shadow-[0_0_0_1px_rgba(59,130,246,0.1)] backdrop-blur-xl">
          <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
          <div className="relative z-10 grid gap-8 md:grid-cols-2 md:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-200 backdrop-blur-lg mb-4">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                For Developers & Startups
              </div>
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl text-white">
                Power your app with Smart Wallet as a Service
              </h2>
              <p className="mt-4 text-base leading-7 text-white/70">
                Don't just hold digital assets—build with them. Our WaaS infrastructure lets you instantly provision wallets for your users, fully abstracting blockchain complexity.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
              <Link
                href="/smart-wallets"
                className="inline-flex h-12 items-center justify-center rounded-full bg-white px-8 text-sm font-semibold text-black transition-colors hover:bg-white/90"
              >
                Explore Smart Wallets
              </Link>
              <Link
                href="/developers"
                className="inline-flex h-12 items-center justify-center rounded-full border border-white/15 bg-white/5 px-8 text-sm text-white/80 backdrop-blur-lg transition-colors hover:bg-white/10"
              >
                View Documentation
              </Link>
            </div>
          </div>
        </section>

        <section id="oversight" className="mt-16">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl md:p-10">
            <div className="grid gap-8 md:grid-cols-2 md:items-center">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                  Built for trust and absolute scale
                </h2>
                <p className="mt-3 text-sm leading-6 text-white/70 md:text-base">
                  Every transaction is cryptographically secured and recorded on an immutable ledger. Provide continuous, real-time auditability to regulators while eliminating manual reconciliation for your finance team.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <a
                  className="inline-flex h-11 items-center justify-center rounded-full border border-white/15 bg-white/5 px-6 text-sm text-white/80 backdrop-blur-lg transition-colors hover:bg-white/10"
                  href="/auth/sign-in"
                >
                  Sign in
                </a>
                <a
                  className="inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90"
                  href="/auth/sign-up"
                >
                  Start now
                </a>
              </div>
            </div>
          </div>
        </section>

        <footer className="mt-20 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-8 text-xs text-white/60 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <div className="overflow-hidden rounded-full">
              <Image src="/ntzs-logo.png" alt="nTZS" width={18} height={18} />
            </div>
            <div>nTZS</div>
          </div>
          <div className="flex items-center gap-4">
            <Link className="hover:text-white" href="/smart-wallets">
              Smart Wallets
            </Link>
            <a className="hover:text-white" href="/auth/sign-in">
              Log in
            </a>
            <a className="hover:text-white" href="/app">
              Dashboard
            </a>
            <Link className="hover:text-white" href="/developers">
              Developers
            </Link>
          </div>
        </footer>
      </main>
    </div>
  )
}
