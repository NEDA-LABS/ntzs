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
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to send code');
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
      if (!res.ok) throw new Error((await res.json()).error || 'Invalid code');
      const data = await res.json();
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
      if (!res.ok) throw new Error((await res.json()).error || 'Login failed');
      router.push('/merchant/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    if (newPassword !== confirmPassword) { setPwError('Passwords do not match'); return; }
    if (newPassword.length < 8) { setPwError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const res = await fetch('/merchant/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to set password');
      router.push('/merchant/dashboard');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to set password');
    } finally {
      setLoading(false);
    }
  }

  const [pwError, setPwError] = useState('');

  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes traceH {
          from { width: 0; opacity: 0; }
          to   { width: 2rem; opacity: 1; }
        }
        @keyframes traceV {
          from { height: 0; opacity: 0; }
          to   { height: 2rem; opacity: 1; }
        }
        .page-reveal   { animation: fadeIn 0.4s ease-out both; }
        .brand-reveal  { animation: fadeUp 0.6s ease-out 0.15s both; }
        .form-reveal   { animation: fadeUp 0.6s ease-out 0.4s both; }
        .props-reveal  { animation: fadeUp 0.5s ease-out 0.7s both; }
        .trace-tl-h    { animation: traceH 0.5s ease-out 0.5s both; }
        .trace-tl-v    { animation: traceV 0.5s ease-out 0.6s both; }
        .trace-br-h    { animation: traceH 0.5s ease-out 0.65s both; }
        .trace-br-v    { animation: traceV 0.5s ease-out 0.75s both; }
      `}</style>

      <div className="page-reveal relative flex min-h-screen bg-zinc-50 font-mono">

        {/* Left panel — brand + form */}
        <div className="flex flex-1 flex-col justify-center px-8 py-12 sm:px-16 lg:px-24 max-w-2xl">

          {/* Top bar label */}
          <div className="brand-reveal mb-14">
            <div className="flex items-center gap-3 mb-8">
              <span className="text-[10px] font-semibold tracking-[0.25em] text-zinc-900 uppercase">
                n<span className="text-emerald-600">TZS</span>
              </span>
              <div className="w-px h-3 bg-zinc-300" />
              <span className="text-[10px] tracking-[0.2em] text-zinc-400 uppercase">Biashara</span>
            </div>

            {/* Headline */}
            <div className="space-y-0">
              <MoneyCounterText
                text="KUZA BIASHARA"
                className="block text-[2.6rem] font-bold tracking-tight leading-[1.05] text-zinc-900"
                delay={80}
              />
              <MoneyCounterText
                text="YAKO."
                className="block text-[2.6rem] font-bold tracking-tight leading-[1.05] text-emerald-600"
                delay={500}
              />
              <div className="h-3" />
              <MoneyCounterText
                text="POKEA MALIPO"
                className="block text-[2.6rem] font-bold tracking-tight leading-[1.05] text-zinc-900"
                delay={860}
              />
              <MoneyCounterText
                text="HARAKA KUPITIA"
                className="block text-[2.6rem] font-bold tracking-tight leading-[1.05] text-zinc-400"
                delay={1180}
              />
              <MoneyCounterText
                text="MTANDAO WOWOTE."
                className="block text-[2.6rem] font-bold tracking-tight leading-[1.05] text-zinc-500"
                delay={1480}
              />
            </div>
          </div>

          {/* Form card */}
          <div className="form-reveal relative bg-white border border-zinc-200 p-8 shadow-sm max-w-sm">
            {/* Corner accents */}
            <div className="pointer-events-none absolute top-0 left-0 overflow-hidden">
              <div className="trace-tl-h absolute top-0 left-0 h-px bg-emerald-500" />
              <div className="trace-tl-v absolute top-0 left-0 w-px bg-emerald-500" />
            </div>
            <div className="pointer-events-none absolute bottom-0 right-0 overflow-hidden">
              <div className="trace-br-h absolute bottom-0 right-0 h-px bg-emerald-500" />
              <div className="trace-br-v absolute bottom-0 right-0 w-px bg-emerald-500" />
            </div>

            {/* ── Email step ── */}
            {step === 'email' && (
              <form onSubmit={handleEmailSubmit} className="space-y-5">
                <div>
                  <label className="mb-2 block text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
                    Business Email
                  </label>
                  <input
                    type="email"
                    autoFocus
                    placeholder="you@business.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none font-mono transition-colors"
                  />
                </div>

                {error && (
                  <p className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full bg-zinc-900 py-3 text-xs font-semibold tracking-widest text-white uppercase transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? 'Sending Code...' : 'Send Email Code'}
                </button>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-zinc-200" />
                  <span className="text-[10px] text-zinc-400 tracking-widest uppercase">or</span>
                  <div className="flex-1 h-px bg-zinc-200" />
                </div>

                <button
                  type="button"
                  disabled={!email.trim()}
                  onClick={() => { setError(''); setStep('password'); }}
                  className="w-full border border-zinc-300 py-3 text-xs font-medium tracking-widest text-zinc-500 uppercase transition-colors hover:border-zinc-400 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Sign In With Password
                </button>
              </form>
            )}

            {/* ── OTP step ── */}
            {step === 'otp' && (
              <form onSubmit={handleOtpSubmit} className="space-y-5">
                <div className="mb-2">
                  <p className="text-xs text-zinc-500 tracking-wide">Code sent to</p>
                  <p className="text-sm font-semibold text-zinc-900 mt-0.5">{email}</p>
                  <button
                    type="button"
                    onClick={() => { setStep('email'); setCode(''); setError(''); }}
                    className="mt-2 text-[10px] tracking-widest text-zinc-400 uppercase hover:text-zinc-600 transition-colors"
                  >
                    Change email
                  </button>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
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
                    className="w-full border border-zinc-300 bg-white px-4 py-3 text-center text-2xl font-bold tracking-widest text-zinc-900 placeholder:text-zinc-300 focus:border-emerald-500 focus:outline-none font-mono transition-colors"
                  />
                </div>

                {error && (
                  <p className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || code.length < 6}
                  className="w-full bg-zinc-900 py-3 text-xs font-semibold tracking-widest text-white uppercase transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? 'Verifying...' : 'Sign In'}
                </button>
              </form>
            )}

            {/* ── Password step ── */}
            {step === 'password' && (
              <form onSubmit={handlePasswordSubmit} className="space-y-5">
                <div>
                  <p className="text-[10px] font-semibold tracking-widest text-zinc-400 uppercase mb-1.5">Signing in as</p>
                  <div className="flex items-center justify-between border border-zinc-200 bg-zinc-50 px-4 py-2.5">
                    <span className="text-sm text-zinc-700 truncate">{email}</span>
                    <button
                      type="button"
                      onClick={() => { setStep('email'); setPassword(''); setError(''); }}
                      className="text-[10px] text-zinc-400 hover:text-zinc-600 uppercase tracking-widest transition-colors shrink-0 ml-3"
                    >
                      Change
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
                    Password
                  </label>
                  <input
                    type="password"
                    autoFocus
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none font-mono transition-colors"
                  />
                </div>

                {error && (
                  <p className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !password}
                  className="w-full bg-zinc-900 py-3 text-xs font-semibold tracking-widest text-white uppercase transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? 'Signing In...' : 'Sign In'}
                </button>

                <button
                  type="button"
                  disabled={loading}
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
                  className="w-full text-[10px] tracking-widest text-zinc-400 uppercase hover:text-zinc-600 transition-colors py-1 disabled:opacity-40"
                >
                  {loading ? 'Sending...' : 'Use email code instead'}
                </button>
              </form>
            )}

            {/* ── Set password step (post-OTP) ── */}
            {step === 'set-password' && (
              <form onSubmit={handleSetPassword} className="space-y-5">
                <div className="border-l-2 border-emerald-500 pl-4">
                  <p className="text-xs font-semibold text-zinc-900 mb-1">You&apos;re in.</p>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Set a password to sign in faster next time — no email code needed.
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
                    New Password
                  </label>
                  <input
                    type="password"
                    autoFocus
                    placeholder="Min. 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none font-mono transition-colors"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    placeholder="Repeat password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none font-mono transition-colors"
                  />
                </div>

                {pwError && (
                  <p className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{pwError}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !newPassword || !confirmPassword}
                  className="w-full bg-zinc-900 py-3 text-xs font-semibold tracking-widest text-white uppercase transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? 'Setting Password...' : 'Set Password & Continue'}
                </button>

                <button
                  type="button"
                  onClick={() => router.push('/merchant/dashboard')}
                  className="w-full text-[10px] tracking-widest text-zinc-400 uppercase hover:text-zinc-600 transition-colors py-1"
                >
                  Skip for now
                </button>
              </form>
            )}
          </div>

          {/* Value props */}
          <div className="props-reveal mt-10 space-y-3 max-w-sm">
            <div className="h-px bg-zinc-200" />
            {[
              'Collect digital payments with ease',
              'Auto-settle a percentage of collections to mobile money',
              'Shareable payment links for any product or service',
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-3 py-1">
                <span className="text-[10px] text-zinc-300 font-mono mt-0.5 w-4 shrink-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="text-xs text-zinc-500 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — decorative, hidden on mobile */}
        <div className="hidden lg:flex flex-1 bg-zinc-900 flex-col justify-between p-16 relative overflow-hidden">
          {/* Subtle grid */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />

          {/* Top label */}
          <div className="relative z-10">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] tracking-widest text-white/30 uppercase">Portal Active</span>
            </div>
          </div>

          {/* Center stat */}
          <div className="relative z-10">
            <p className="text-[10px] tracking-widest text-white/25 uppercase mb-3">Network</p>
            <p className="text-5xl font-bold text-white tracking-tight mb-1">nTZS</p>
            <p className="text-sm text-emerald-400 tracking-widest uppercase font-medium">Tanzania Shilling</p>
            <p className="text-xs text-white/30 mt-4 leading-relaxed max-w-xs">
              Accept payments from any mobile network, settle instantly to your mobile money account.
            </p>
          </div>

          {/* Bottom */}
          <div className="relative z-10 flex items-center justify-between">
            <span className="text-[10px] tracking-widest text-white/20 uppercase">Secure · Mobile Money</span>
            <span className="text-[10px] tracking-widest text-white/20 uppercase">ntzs.co.tz</span>
          </div>
        </div>

      </div>
    </>
  );
}
