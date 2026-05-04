'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function MoneyCounterText({
  text,
  className = '',
  delay = 0,
}: {
  text: string
  className?: string
  delay?: number
}) {
  const chars = text.split('')
  const [display, setDisplay] = useState<string[]>(() =>
    chars.map(c => (c === ' ' || c === '.' || c === '/' || c === ',')
      ? c
      : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
    )
  )
  const idRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const FRAME_MS = 48
    const STAGGER = 38
    const DURATION = 620
    let elapsed = -delay

    idRef.current = setInterval(() => {
      elapsed += FRAME_MS
      let allDone = true

      setDisplay(
        chars.map((char, i) => {
          if (char === ' ' || char === '.' || char === '/' || char === ',') return char
          const t = elapsed - i * STAGGER
          if (t < 0) { allDone = false; return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)] }
          if (t >= DURATION) return char
          allDone = false
          return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
        })
      )

      if (allDone && idRef.current) clearInterval(idRef.current)
    }, FRAME_MS)

    return () => { if (idRef.current) clearInterval(idRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <span className={className}>{display.join('')}</span>
}

type Step = 'email' | 'otp' | 'password' | 'set-password';

export function MerchantSignIn() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  // ── Email → OTP ──────────────────────────────────────────────────────────

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/merchant/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to send code');
      }
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!code.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/merchant/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Invalid code');
      }
      const data = await res.json();
      // Prompt to set a password for future logins if they don't have one yet
      if (!data.hasPassword) {
        setStep('set-password');
      } else {
        router.push('/merchant/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  // ── Password login ────────────────────────────────────────────────────────

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      const res = await fetch('/merchant/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Login failed');
      }
      router.push('/merchant/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  // ── Set password (post-OTP prompt) ────────────────────────────────────────

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/merchant/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to set password');
      }
      router.push('/merchant/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        @keyframes traceTopLeft {
          0%   { width: 0; height: 0; opacity: 0; }
          30%  { width: 3rem; height: 0; opacity: 1; }
          60%  { width: 3rem; height: 3rem; opacity: 1; }
          100% { width: 3rem; height: 3rem; opacity: 1; }
        }
        @keyframes traceTopRight {
          0%   { width: 0; height: 0; opacity: 0; }
          30%  { width: 3rem; height: 0; opacity: 1; }
          60%  { width: 3rem; height: 3rem; opacity: 1; }
          100% { width: 3rem; height: 3rem; opacity: 1; }
        }
        @keyframes traceBottomLeft {
          0%   { width: 0; height: 0; opacity: 0; }
          30%  { width: 0; height: 3rem; opacity: 1; }
          60%  { width: 3rem; height: 3rem; opacity: 1; }
          100% { width: 3rem; height: 3rem; opacity: 1; }
        }
        @keyframes traceBottomRight {
          0%   { width: 0; height: 0; opacity: 0; }
          30%  { width: 0; height: 3rem; opacity: 1; }
          60%  { width: 3rem; height: 3rem; opacity: 1; }
          100% { width: 3rem; height: 3rem; opacity: 1; }
        }
        @keyframes scan {
          0%   { top: 0%; opacity: 0; }
          4%   { opacity: 1; }
          96%  { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes cardGlow {
          0%, 100% { box-shadow: 0 0 0px rgba(74,222,128,0); }
          50%       { box-shadow: 0 0 32px rgba(74,222,128,0.07); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes gridShift {
          0%   { background-position: 0 0; }
          100% { background-position: 40px 40px; }
        }
        .corner-tl { animation: traceTopLeft 0.9s cubic-bezier(0.4,0,0.2,1) 0.1s both; }
        .corner-tr { animation: traceTopRight 0.9s cubic-bezier(0.4,0,0.2,1) 0.25s both; }
        .corner-bl { animation: traceBottomLeft 0.9s cubic-bezier(0.4,0,0.2,1) 0.4s both; }
        .corner-br { animation: traceBottomRight 0.9s cubic-bezier(0.4,0,0.2,1) 0.55s both; }
        .scan-line  { animation: scan 4s ease-in-out 1.5s infinite; }
        .card-glow  { animation: cardGlow 3s ease-in-out 1s infinite; }
        .brand-reveal { animation: fadeUp 0.7s ease-out 0.2s both; }
        .form-reveal  { animation: fadeUp 0.7s ease-out 0.6s both; }
        .props-reveal { animation: fadeUp 0.6s ease-out 1.1s both; }
        .page-reveal  { animation: fadeIn 0.5s ease-out both; }
        .grid-bg {
          background-image:
            linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px);
          background-size: 40px 40px;
          animation: gridShift 12s linear infinite;
        }
        .card-corner-tl { animation: traceTopLeft 0.7s cubic-bezier(0.4,0,0.2,1) 0.8s both; }
        .card-corner-tr { animation: traceTopRight 0.7s cubic-bezier(0.4,0,0.2,1) 0.9s both; }
        .card-corner-bl { animation: traceBottomLeft 0.7s cubic-bezier(0.4,0,0.2,1) 1.0s both; }
        .card-corner-br { animation: traceBottomRight 0.7s cubic-bezier(0.4,0,0.2,1) 1.1s both; }
      `}</style>

      <div className="page-reveal relative flex min-h-screen items-center justify-center bg-black p-4 font-mono overflow-hidden">

        {/* Animated grid background */}
        <div className="pointer-events-none absolute inset-0 grid-bg" />
        {/* Radial vignette */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_50%,transparent_40%,rgba(0,0,0,0.7)_100%)]" />

        {/* Page corner frame */}
        <div className="pointer-events-none absolute top-0 left-0 border-t border-l border-white/20 corner-tl" />
        <div className="pointer-events-none absolute top-0 right-0 border-t border-r border-white/20 corner-tr" />
        <div className="pointer-events-none absolute bottom-0 left-0 border-b border-l border-white/20 corner-bl" />
        <div className="pointer-events-none absolute bottom-0 right-0 border-b border-r border-white/20 corner-br" />

        {/* Top bar */}
        <div className="pointer-events-none absolute top-0 left-0 right-0 border-b border-white/10 px-6 py-3 flex items-center justify-between">
          <span className="text-[10px] tracking-widest text-white/30 uppercase">nTZS / Biashara</span>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] tracking-widest text-white/25 uppercase">Portal Active</span>
          </div>
        </div>

        <div className="relative w-full max-w-sm z-10">

          {/* Brand */}
          <div className="brand-reveal mb-10">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-6 h-px bg-emerald-400/60" />
              <span className="text-[10px] tracking-widest text-emerald-500/60 uppercase">001</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <p className="text-[11px] font-medium tracking-[0.32em] text-white/25 uppercase mb-4">Biashara</p>

            <div className="space-y-0.5">
              <MoneyCounterText text="KUZA BIASHARA" className="block text-3xl font-bold tracking-wider uppercase leading-tight text-white" delay={80} />
              <MoneyCounterText text="YAKO." className="block text-3xl font-bold tracking-wider uppercase leading-tight text-emerald-400" delay={500} />
              <div className="h-1" />
              <MoneyCounterText text="POKEA MALIPO" className="block text-3xl font-bold tracking-wider uppercase leading-tight text-white" delay={860} />
              <MoneyCounterText text="HARAKA KUPITIA" className="block text-3xl font-bold tracking-wider uppercase leading-tight text-white/50" delay={1180} />
              <MoneyCounterText text="MTANDAO WOWOTE." className="block text-3xl font-bold tracking-wider uppercase leading-tight text-emerald-400/65" delay={1480} />
            </div>
          </div>

          {/* Form card */}
          <div className="form-reveal relative border border-white/10 p-6 bg-white/[0.02] card-glow overflow-hidden">
            <div className="scan-line pointer-events-none absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400/30 to-transparent" style={{ top: 0 }} />
            <div className="card-corner-tl pointer-events-none absolute top-0 left-0 border-t border-l border-emerald-500/40" />
            <div className="card-corner-tr pointer-events-none absolute top-0 right-0 border-t border-r border-emerald-500/40" />
            <div className="card-corner-bl pointer-events-none absolute bottom-0 left-0 border-b border-l border-emerald-500/40" />
            <div className="card-corner-br pointer-events-none absolute bottom-0 right-0 border-b border-r border-emerald-500/40" />

            {/* ── Email step ── */}
            {step === 'email' && (
              <form onSubmit={handleEmailSubmit} className="space-y-5">
                <div>
                  <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/40 uppercase">
                    Business Email
                  </label>
                  <input
                    type="email"
                    autoFocus
                    placeholder="you@business.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-white/10 bg-black px-4 py-3 text-sm text-white placeholder:text-white/15 focus:border-emerald-500/50 focus:outline-none font-mono transition-colors"
                  />
                </div>

                {error && (
                  <p className="border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full border border-emerald-500/40 bg-emerald-500/10 py-3 text-xs font-medium tracking-widest text-emerald-400 uppercase transition-all hover:bg-emerald-500/20 hover:border-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? 'Sending Code...' : 'Send Email Code'}
                </button>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-white/5" />
                  <span className="text-[10px] text-white/20 tracking-widest uppercase">or</span>
                  <div className="flex-1 h-px bg-white/5" />
                </div>

                <button
                  type="button"
                  disabled={!email.trim()}
                  onClick={() => { setError(''); setStep('password'); }}
                  className="w-full border border-white/10 py-3 text-xs tracking-widest text-white/40 uppercase transition-all hover:border-white/20 hover:text-white/60 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Sign In With Password
                </button>
              </form>
            )}

            {/* ── OTP step ── */}
            {step === 'otp' && (
              <form onSubmit={handleOtpSubmit} className="space-y-5">
                <div className="mb-4">
                  <p className="text-xs text-white/35 tracking-wide">Verification code sent to</p>
                  <p className="text-sm text-white mt-0.5">{email}</p>
                  <button
                    type="button"
                    onClick={() => { setStep('email'); setCode(''); setError(''); }}
                    className="mt-2 text-[10px] tracking-widest text-white/25 uppercase hover:text-white/50 transition-colors"
                  >
                    Change email
                  </button>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/40 uppercase">
                    6-Digit Code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full border border-white/10 bg-black px-4 py-3 text-center text-2xl font-bold tracking-widest text-white placeholder:text-white/10 focus:border-emerald-500/50 focus:outline-none font-mono transition-colors"
                  />
                </div>

                {error && (
                  <p className="border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || code.length < 6}
                  className="w-full border border-emerald-500/40 bg-emerald-500/10 py-3 text-xs font-medium tracking-widest text-emerald-400 uppercase transition-all hover:bg-emerald-500/20 hover:border-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? 'Verifying...' : 'Sign In'}
                </button>
              </form>
            )}

            {/* ── Password step ── */}
            {step === 'password' && (
              <form onSubmit={handlePasswordSubmit} className="space-y-5">
                <div>
                  <p className="text-[10px] font-medium tracking-widest text-white/40 uppercase mb-1">Signing in as</p>
                  <div className="flex items-center justify-between border border-white/10 bg-black px-4 py-2.5">
                    <span className="text-sm text-white/70 truncate">{email}</span>
                    <button
                      type="button"
                      onClick={() => { setStep('email'); setPassword(''); setError(''); }}
                      className="text-[10px] text-white/25 hover:text-white/50 uppercase tracking-widest transition-colors shrink-0 ml-3"
                    >
                      Change
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/40 uppercase">
                    Password
                  </label>
                  <input
                    type="password"
                    autoFocus
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border border-white/10 bg-black px-4 py-3 text-sm text-white placeholder:text-white/15 focus:border-emerald-500/50 focus:outline-none font-mono transition-colors"
                  />
                </div>

                {error && (
                  <p className="border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !password}
                  className="w-full border border-emerald-500/40 bg-emerald-500/10 py-3 text-xs font-medium tracking-widest text-emerald-400 uppercase transition-all hover:bg-emerald-500/20 hover:border-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? 'Signing In...' : 'Sign In'}
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    setError('');
                    setLoading(true);
                    try {
                      const res = await fetch('/merchant/api/auth/request-otp', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: email.trim() }),
                      });
                      if (!res.ok) throw new Error((await res.json()).error || 'Failed to send code');
                      setPassword('');
                      setStep('otp');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Something went wrong');
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="w-full text-[10px] tracking-widest text-white/25 uppercase hover:text-white/45 transition-colors py-1 disabled:opacity-40"
                >
                  {loading ? 'Sending...' : 'Use email code instead'}
                </button>
              </form>
            )}

            {/* ── Set password step (after OTP, no password yet) ── */}
            {step === 'set-password' && (
              <form onSubmit={handleSetPassword} className="space-y-5">
                <div className="border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-3">
                  <p className="text-[10px] font-medium tracking-widest text-emerald-400/80 uppercase mb-1">Signed in</p>
                  <p className="text-xs text-white/50 leading-relaxed">
                    Set a password so you can sign in faster next time — no email code needed.
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/40 uppercase">
                    New Password
                  </label>
                  <input
                    type="password"
                    autoFocus
                    placeholder="Min. 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full border border-white/10 bg-black px-4 py-3 text-sm text-white placeholder:text-white/15 focus:border-emerald-500/50 focus:outline-none font-mono transition-colors"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/40 uppercase">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    placeholder="Repeat password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full border border-white/10 bg-black px-4 py-3 text-sm text-white placeholder:text-white/15 focus:border-emerald-500/50 focus:outline-none font-mono transition-colors"
                  />
                </div>

                {error && (
                  <p className="border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !newPassword || !confirmPassword}
                  className="w-full border border-emerald-500/40 bg-emerald-500/10 py-3 text-xs font-medium tracking-widest text-emerald-400 uppercase transition-all hover:bg-emerald-500/20 hover:border-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? 'Setting Password...' : 'Set Password & Continue'}
                </button>

                <button
                  type="button"
                  onClick={() => router.push('/merchant/dashboard')}
                  className="w-full text-[10px] tracking-widest text-white/25 uppercase hover:text-white/45 transition-colors py-1"
                >
                  Skip for now
                </button>
              </form>
            )}
          </div>

          {/* Value props */}
          <div className="props-reveal mt-8 space-y-3">
            <div className="h-px bg-white/5" />
            {[
              'Collect digital payments with ease',
              'Auto-settle a percentage of collections to mobile money',
              'Shareable payment links for any product or service',
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-3 py-1">
                <span className="text-[10px] text-white/20 font-mono mt-0.5 w-4 shrink-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="text-xs text-white/30 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 border-t border-white/10 px-6 py-3 flex items-center justify-between">
          <span className="text-[10px] tracking-widest text-white/15 uppercase">nTZS Network</span>
          <span className="text-[10px] tracking-widest text-white/15 uppercase">Secure · Mobile Money</span>
        </div>
      </div>
    </>
  );
}
