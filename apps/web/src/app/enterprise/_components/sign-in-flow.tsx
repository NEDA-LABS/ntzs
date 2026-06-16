'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Step = 'email' | 'otp' | 'password'

export function EnterpriseSignIn() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  // Mouse-reactive sheen on the premium card (lightweight rAF, no GSAP).
  const cardRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  useEffect(() => {
    function onMove(e: MouseEvent) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const el = cardRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        el.style.setProperty('--mx', `${e.clientX - r.left}px`)
        el.style.setProperty('--my', `${e.clientY - r.top}px`)
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => { window.removeEventListener('mousemove', onMove); cancelAnimationFrame(rafRef.current) }
  }, [])

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!email.trim()) return
    setLoading(true)
    try {
      await fetch('/enterprise/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      // Always advance — don't leak account existence
      setStep('otp')
    } catch {
      setError('Failed to send code. Try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!code.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/enterprise/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Invalid code')
      router.push('/enterprise/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) return
    setLoading(true)
    try {
      const res = await fetch('/enterprise/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Login failed')
      router.push('/enterprise/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        @keyframes eFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes eFadeIn { from { opacity: 0; } to { opacity: 1; } }
        .e-page    { animation: eFadeIn 0.5s ease-out both; }
        .e-brand   { animation: eFadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s both; }
        .e-card    { animation: eFadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.28s both; }
        .e-props   { animation: eFadeUp 0.6s ease-out 0.5s both; }

        /* Film grain + masked grid environment */
        .e-grain {
          position:absolute; inset:0; pointer-events:none; z-index:1; opacity:0.045; mix-blend-mode:overlay;
          background:url('data:image/svg+xml;utf8,<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/></filter><rect width="100%25" height="100%25" filter="url(%23n)"/></svg>');
        }
        .e-grid {
          position:absolute; inset:0; pointer-events:none;
          background-size:56px 56px;
          background-image:linear-gradient(to right, rgba(99,102,241,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(99,102,241,0.07) 1px, transparent 1px);
          -webkit-mask-image:radial-gradient(ellipse 75% 75% at 50% 40%, black 0%, transparent 72%);
          mask-image:radial-gradient(ellipse 75% 75% at 50% 40%, black 0%, transparent 72%);
        }

        /* Silver matte heading */
        .e-silver {
          background:linear-gradient(180deg,#FFFFFF 0%, #93A4C9 100%);
          -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;
          transform:translateZ(0);
          filter:drop-shadow(0 10px 22px rgba(99,102,241,0.18));
        }

        /* Premium physical depth card */
        .e-card-surface {
          background:linear-gradient(150deg, #18306F 0%, #0B1120 62%, #080C16 100%);
          box-shadow:
            0 44px 110px -24px rgba(0,0,0,0.92),
            0 22px 44px -22px rgba(0,0,0,0.8),
            inset 0 1px 2px rgba(255,255,255,0.16),
            inset 0 -2px 4px rgba(0,0,0,0.8);
          border:1px solid rgba(255,255,255,0.07);
        }
        .e-sheen {
          position:absolute; inset:0; border-radius:inherit; pointer-events:none; z-index:2;
          background:radial-gradient(600px circle at var(--mx,50%) var(--my,30%), rgba(255,255,255,0.07) 0%, transparent 42%);
          mix-blend-mode:screen;
        }

        /* Tactile inputs */
        .e-input {
          width:100%; background:rgba(5,8,16,0.6); color:#E8EDF7;
          border:1px solid rgba(255,255,255,0.08);
          box-shadow:inset 0 2px 5px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.03);
          border-radius:10px; transition:border-color .2s, box-shadow .2s;
        }
        .e-input::placeholder { color:#5A6580; }
        .e-input:focus { outline:none; border-color:rgba(129,140,248,0.7); box-shadow:inset 0 2px 5px rgba(0,0,0,0.55), 0 0 0 3px rgba(99,102,241,0.18); }

        /* Tactile buttons */
        .e-btn-primary {
          background:linear-gradient(180deg,#6366F1 0%, #4338CA 100%); color:#fff;
          box-shadow:0 0 0 1px rgba(0,0,0,0.2), 0 12px 24px -8px rgba(67,56,202,0.7), inset 0 1px 1px rgba(255,255,255,0.3), inset 0 -3px 6px rgba(0,0,0,0.35);
          border-radius:12px; transition:all .25s cubic-bezier(0.25,1,0.5,1);
        }
        .e-btn-primary:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 0 0 1px rgba(0,0,0,0.2), 0 18px 30px -8px rgba(67,56,202,0.85), inset 0 1px 1px rgba(255,255,255,0.35), inset 0 -3px 6px rgba(0,0,0,0.35); }
        .e-btn-primary:active:not(:disabled) { transform:translateY(1px); background:#3F35B8; box-shadow:inset 0 3px 8px rgba(0,0,0,0.6); }
        .e-btn-primary:disabled { opacity:0.4; cursor:not-allowed; }

        .e-btn-ghost {
          background:linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%); color:#AEB8D0;
          border:1px solid rgba(255,255,255,0.1);
          box-shadow:inset 0 1px 1px rgba(255,255,255,0.06), inset 0 -2px 4px rgba(0,0,0,0.4);
          border-radius:12px; transition:all .25s cubic-bezier(0.25,1,0.5,1);
        }
        .e-btn-ghost:hover:not(:disabled) { color:#E8EDF7; border-color:rgba(255,255,255,0.2); transform:translateY(-1px); }
        .e-btn-ghost:disabled { opacity:0.3; cursor:not-allowed; }
      `}</style>

      <div className="e-page relative flex min-h-screen items-center justify-center font-mono px-6 py-16 overflow-hidden" style={{ background: 'radial-gradient(ellipse 90% 90% at 50% 0%, #0d1733 0%, #05070d 60%, #03040a 100%)' }}>
        <div className="e-grid" aria-hidden="true" />
        <div className="e-grain" aria-hidden="true" />

        <div className="relative z-10 w-full max-w-sm">

          <div className="e-brand mb-10">
            <div className="flex items-center gap-3 mb-7">
              <span className="text-[10px] font-semibold tracking-[0.25em] text-slate-100 uppercase">
                n<span className="text-indigo-400">TZS</span>
              </span>
              <div className="w-px h-3 bg-slate-700" />
              <span className="text-[10px] tracking-[0.2em] text-slate-500 uppercase">Enterprise</span>
            </div>

            <div className="space-y-1">
              <p className="text-[2.1rem] leading-[1.1] font-semibold tracking-tight e-silver">Capital &amp; Payment</p>
              <p className="text-[2.1rem] leading-[1.1] font-semibold tracking-tight text-indigo-400">Infrastructure.</p>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed max-w-xs">
                Programmable TZS liquidity for Tanzania&apos;s FMCG supply chain.
              </p>
            </div>
          </div>

          {/* Premium form card */}
          <div ref={cardRef} className="e-card e-card-surface relative rounded-2xl p-8">
            <div className="e-sheen" aria-hidden="true" />
            <div className="relative z-[3]">

              {/* Email step */}
              {step === 'email' && (
                <form onSubmit={handleEmailSubmit} className="space-y-5">
                  <div>
                    <label className="mb-2 block text-[10px] font-semibold tracking-widest text-slate-400 uppercase">
                      Organisation Email
                    </label>
                    <input
                      type="email"
                      autoFocus
                      placeholder="you@organisation.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="e-input px-4 py-3 text-sm font-mono"
                    />
                  </div>

                  {error && <p className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">{error}</p>}

                  <button
                    type="submit"
                    disabled={loading || !email.trim()}
                    className="e-btn-primary w-full py-3 text-xs font-semibold tracking-widest uppercase"
                  >
                    {loading ? 'Sending Code...' : 'Send Email Code'}
                  </button>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-[10px] text-slate-500 tracking-widest uppercase">or</span>
                    <div className="flex-1 h-px bg-white/10" />
                  </div>

                  <button
                    type="button"
                    disabled={!email.trim()}
                    onClick={() => { setError(''); setStep('password') }}
                    className="e-btn-ghost w-full py-3 text-xs font-medium tracking-widest uppercase"
                  >
                    Sign In With Password
                  </button>

                  <p className="text-center text-[10px] text-slate-500">
                    New organisation?{' '}
                    <Link href="/enterprise/signup" className="text-indigo-400 hover:text-indigo-300 transition-colors">
                      Request access
                    </Link>
                  </p>
                </form>
              )}

              {/* OTP step */}
              {step === 'otp' && (
                <form onSubmit={handleOtpSubmit} className="space-y-5">
                  <div className="mb-2">
                    <p className="text-xs text-slate-400 tracking-wide">Code sent to</p>
                    <p className="text-sm font-semibold text-slate-100 mt-0.5">{email}</p>
                    <button type="button" onClick={() => { setStep('email'); setCode(''); setError('') }} className="mt-2 text-[10px] tracking-widest text-slate-500 uppercase hover:text-slate-300 transition-colors">
                      Change email
                    </button>
                  </div>

                  <div>
                    <label className="mb-2 block text-[10px] font-semibold tracking-widest text-slate-400 uppercase">6-Digit Code</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoFocus
                      maxLength={6}
                      placeholder="000000"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      className="e-input px-4 py-3 text-center text-2xl font-bold tracking-widest text-indigo-300 font-mono"
                    />
                  </div>

                  {error && <p className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">{error}</p>}

                  <button
                    type="submit"
                    disabled={loading || code.length < 6}
                    className="e-btn-primary w-full py-3 text-xs font-semibold tracking-widest uppercase"
                  >
                    {loading ? 'Verifying...' : 'Sign In'}
                  </button>
                </form>
              )}

              {/* Password step */}
              {step === 'password' && (
                <form onSubmit={handlePasswordSubmit} className="space-y-5">
                  <div>
                    <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-1.5">Signing in as</p>
                    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/60 px-4 py-2.5">
                      <span className="text-sm text-slate-200 truncate">{email}</span>
                      <button type="button" onClick={() => { setStep('email'); setPassword(''); setError('') }} className="text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-widest transition-colors shrink-0 ml-3">
                        Change
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-[10px] font-semibold tracking-widest text-slate-400 uppercase">Password</label>
                    <input
                      type="password"
                      autoFocus
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="e-input px-4 py-3 text-sm font-mono"
                    />
                  </div>

                  {error && <p className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">{error}</p>}

                  <button
                    type="submit"
                    disabled={loading || !password}
                    className="e-btn-primary w-full py-3 text-xs font-semibold tracking-widest uppercase"
                  >
                    {loading ? 'Signing In...' : 'Sign In'}
                  </button>

                  <button
                    type="button"
                    disabled={loading}
                    onClick={async () => {
                      setError(''); setLoading(true)
                      try {
                        await fetch('/enterprise/api/auth/request-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
                        setPassword(''); setStep('otp')
                      } catch { setError('Failed to send code') } finally { setLoading(false) }
                    }}
                    className="w-full text-[10px] tracking-widest text-slate-500 uppercase hover:text-slate-300 transition-colors py-1 disabled:opacity-40"
                  >
                    Use email code instead
                  </button>
                </form>
              )}

            </div>
          </div>

          {/* Serves both account types */}
          <p className="e-props mt-5 text-center text-[10px] tracking-wide text-slate-500">
            One sign-in for{' '}
            <span className="text-slate-300">capital lenders</span> &amp;{' '}
            <span className="text-slate-300">disbursement partners</span>
          </p>

          <div className="e-props mt-6 space-y-3">
            <div className="h-px bg-white/10" />
            {[
              'Revenue-based repayment — embedded in every transaction',
              'Real-time on-chain audit trail on Base mainnet',
              'Bulk contractor disbursement — built in-app',
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-3 py-1">
                <span className="text-[10px] text-slate-600 font-mono mt-0.5 w-4 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                <p className="text-xs text-slate-500 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>

        </div>
      </div>
    </>
  )
}
