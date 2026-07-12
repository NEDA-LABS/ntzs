import { AuthView } from '@neondatabase/neon-js/auth/react/ui'
import Image from 'next/image'
import Link from 'next/link'

import { DIRECT_APP_SIGNUP_PAUSED, NEDAPAY_APP_URL, WALLET_CREATION_PAUSED } from '@/lib/wallet-gating'

export const dynamicParams = false

export default async function AuthPage({
  params,
}: {
  params: Promise<{ path: string }>
}) {
  const { path } = await params

  const isSignUp = path === 'sign-up'
  // With Selcom Identity configured, new accounts CAN proceed (sign up → NIDA
  // verification → wallet); the banner switches from "paused" to "verification
  // required". Without credentials, creation is genuinely paused.
  const kycConfigured = Boolean(process.env.SELCOM_IDENTITY_API_KEY && process.env.SELCOM_IDENTITY_API_SECRET)

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">

      {/* ── Full-screen video background ── */}
      <video
        src="/HERO.mp4"
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 h-full w-full object-cover opacity-30"
      />

      {/* ── Gradient scrim so card stays readable ── */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-black/70" />

      {/* ── Subtle grid drift ── */}
      <div className="pointer-events-none absolute inset-0 ntzs-auth-grid-drift bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:56px_56px]" />

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-10 lg:px-12">
        <div className="grid w-full gap-12 lg:grid-cols-2 lg:items-center">

          {/* ── Left: Branding ── */}
          <div className="hidden lg:flex lg:flex-col lg:gap-8">
            <Link href="/" className="inline-flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/40 backdrop-blur">
                <Image src="/ntzs-logo.png" alt="nTZS" width={28} height={28} />
              </div>
              <span className="text-sm font-medium tracking-widest text-white/60 uppercase">nTZS</span>
            </Link>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40 mb-4">
                Built for Africa
              </p>
              <h1 className="text-5xl font-thin leading-tight tracking-tight text-white xl:text-6xl">
                Digital<br />Payment<br />Gateway
              </h1>
              <div className="mt-6 h-px w-16 bg-white/20" />
              <p className="mt-6 max-w-sm text-sm font-light leading-relaxed text-white/50">
                The on-chain Tanzanian Shilling. Send, swap, and earn — with the speed of blockchain and the stability of TZS.
              </p>
            </div>

            <div className="flex items-center gap-6 text-xs text-white/30">
              <span>Base Network</span>
              <span>·</span>
              <span>1:1 TZS Pegged</span>
              <span>·</span>
              <span>Non-custodial</span>
            </div>
          </div>

          {/* ── Right: Auth card ── */}
          <div className="w-full max-w-md mx-auto lg:mx-0 lg:ml-auto">
            {/* Mobile logo */}
            <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/40 backdrop-blur">
                <Image src="/ntzs-logo.png" alt="nTZS" width={28} height={28} />
              </div>
              <span className="text-sm font-medium tracking-widest text-white/60 uppercase">nTZS</span>
            </div>

            <div className="ntzs-auth-entrance relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl md:p-9">
              <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl" />
              <div className="pointer-events-none absolute -right-24 -bottom-24 h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" />

              <div className="relative">
                {isSignUp && DIRECT_APP_SIGNUP_PAUSED ? (
                  <div className="py-2">
                    <h2 className="text-xl font-semibold text-white">Sign-ups have moved to NEDApay</h2>
                    <p className="mt-3 text-sm leading-relaxed text-white/60">
                      Our Bank of Tanzania sandbox pilot on this app is at capacity, so new nTZS accounts
                      are now created in the NEDApay app — same shilling, verified in minutes.
                    </p>
                    <a
                      href={NEDAPAY_APP_URL}
                      className="mt-6 flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90"
                    >
                      Continue on NEDApay →
                    </a>
                    <p className="mt-4 text-xs leading-relaxed text-white/40">
                      Already have an nTZS account? Signing in works as usual.
                    </p>
                  </div>
                ) : (
                  <>
                    {isSignUp && WALLET_CREATION_PAUSED && (
                      kycConfigured ? (
                        <div className="mb-5 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-xs leading-relaxed text-emerald-100">
                          Identity verification is required for new accounts (Bank of Tanzania sandbox). After signing up,
                          you&apos;ll verify with your NIDA number — it takes under a minute.
                        </div>
                      ) : (
                        <div className="mb-5 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-xs leading-relaxed text-amber-100">
                          New sign-ups are temporarily paused while we finalise identity verification for the Bank of Tanzania
                          sandbox. Existing accounts can still sign in — please check back soon.
                        </div>
                      )
                    )}
                    <AuthView path={path} />
                  </>
                )}

                <div className="mt-6 flex items-center justify-between text-xs text-white/40">
                  <Link href="/" className="hover:text-white/70 transition-colors">
                    ← Back to home
                  </Link>
                  {isSignUp && (
                    <Link href="/auth/sign-in" className="hover:text-white/70 transition-colors">
                      Sign in instead
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
