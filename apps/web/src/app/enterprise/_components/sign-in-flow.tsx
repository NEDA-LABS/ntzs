'use client'

import { useState } from 'react'
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
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes traceH { from { width: 0; opacity: 0; } to { width: 2rem; opacity: 1; } }
        @keyframes traceV { from { height: 0; opacity: 0; } to { height: 2rem; opacity: 1; } }
        .page-reveal  { animation: fadeIn 0.4s ease-out both; }
        .brand-reveal { animation: fadeUp 0.6s ease-out 0.15s both; }
        .form-reveal  { animation: fadeUp 0.6s ease-out 0.4s both; }
        .props-reveal { animation: fadeUp 0.5s ease-out 0.7s both; }
        .trace-tl-h   { animation: traceH 0.5s ease-out 0.5s both; }
        .trace-tl-v   { animation: traceV 0.5s ease-out 0.6s both; }
        .trace-br-h   { animation: traceH 0.5s ease-out 0.65s both; }
        .trace-br-v   { animation: traceV 0.5s ease-out 0.75s both; }
      `}</style>

      <div className="page-reveal relative flex min-h-screen items-center justify-center font-mono px-6 py-16 overflow-hidden bg-slate-950">
        {/* Subtle grid bg */}
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(rgba(99,102,241,1) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,1) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 80% at center, rgba(15,23,42,0.6) 0%, rgba(15,23,42,0.95) 100%)' }} />

        <div className="relative z-10 w-full max-w-sm">

          <div className="brand-reveal mb-12">
            <div className="flex items-center gap-3 mb-8">
              <span className="text-[10px] font-semibold tracking-[0.25em] text-slate-100 uppercase">
                n<span className="text-indigo-400">TZS</span>
              </span>
              <div className="w-px h-3 bg-slate-700" />
              <span className="text-[10px] tracking-[0.2em] text-slate-500 uppercase">Enterprise</span>
            </div>

            <div className="space-y-1">
              <p className="text-3xl font-light text-slate-100 leading-tight">Capital &amp; Payment</p>
              <p className="text-3xl font-light text-indigo-400 leading-tight">Infrastructure.</p>
              <p className="mt-3 text-sm text-slate-500 leading-relaxed max-w-xs">
                Programmable TZS liquidity for Tanzania&apos;s FMCG supply chain.
              </p>
            </div>
          </div>

          {/* Form card */}
          <div className="form-reveal relative bg-slate-900 border border-slate-800 p-8 shadow-2xl">
            <div className="pointer-events-none absolute top-0 left-0">
              <div className="trace-tl-h absolute top-0 left-0 h-px bg-indigo-500" />
              <div className="trace-tl-v absolute top-0 left-0 w-px bg-indigo-500" />
            </div>
            <div className="pointer-events-none absolute bottom-0 right-0">
              <div className="trace-br-h absolute bottom-0 right-0 h-px bg-indigo-500" />
              <div className="trace-br-v absolute bottom-0 right-0 w-px bg-indigo-500" />
            </div>

            {/* Email step */}
            {step === 'email' && (
              <form onSubmit={handleEmailSubmit} className="space-y-5">
                <div>
                  <label className="mb-2 block text-[10px] font-semibold tracking-widest text-slate-500 uppercase">
                    Organisation Email
                  </label>
                  <input
                    type="email"
                    autoFocus
                    placeholder="you@organisation.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none font-mono transition-colors"
                  />
                </div>

                {error && <p className="border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-400">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full bg-indigo-600 py-3 text-xs font-semibold tracking-widest text-white uppercase transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? 'Sending Code...' : 'Send Email Code'}
                </button>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-slate-800" />
                  <span className="text-[10px] text-slate-600 tracking-widest uppercase">or</span>
                  <div className="flex-1 h-px bg-slate-800" />
                </div>

                <button
                  type="button"
                  disabled={!email.trim()}
                  onClick={() => { setError(''); setStep('password') }}
                  className="w-full border border-slate-700 py-3 text-xs font-medium tracking-widest text-slate-500 uppercase transition-colors hover:border-slate-600 hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Sign In With Password
                </button>

                <p className="text-center text-[10px] text-slate-600">
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
                  <p className="text-xs text-slate-500 tracking-wide">Code sent to</p>
                  <p className="text-sm font-semibold text-slate-100 mt-0.5">{email}</p>
                  <button type="button" onClick={() => { setStep('email'); setCode(''); setError('') }} className="mt-2 text-[10px] tracking-widest text-slate-600 uppercase hover:text-slate-400 transition-colors">
                    Change email
                  </button>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-semibold tracking-widest text-slate-500 uppercase">6-Digit Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full border border-slate-700 bg-slate-950 px-4 py-3 text-center text-2xl font-bold tracking-widest text-indigo-400 placeholder:text-slate-700 focus:border-indigo-500 focus:outline-none font-mono transition-colors"
                  />
                </div>

                {error && <p className="border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-400">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || code.length < 6}
                  className="w-full bg-indigo-600 py-3 text-xs font-semibold tracking-widest text-white uppercase transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? 'Verifying...' : 'Sign In'}
                </button>
              </form>
            )}

            {/* Password step */}
            {step === 'password' && (
              <form onSubmit={handlePasswordSubmit} className="space-y-5">
                <div>
                  <p className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1.5">Signing in as</p>
                  <div className="flex items-center justify-between border border-slate-700 bg-slate-950 px-4 py-2.5">
                    <span className="text-sm text-slate-300 truncate">{email}</span>
                    <button type="button" onClick={() => { setStep('email'); setPassword(''); setError('') }} className="text-[10px] text-slate-600 hover:text-slate-400 uppercase tracking-widest transition-colors shrink-0 ml-3">
                      Change
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Password</label>
                  <input
                    type="password"
                    autoFocus
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none font-mono transition-colors"
                  />
                </div>

                {error && <p className="border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-400">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || !password}
                  className="w-full bg-indigo-600 py-3 text-xs font-semibold tracking-widest text-white uppercase transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
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
                  className="w-full text-[10px] tracking-widest text-slate-600 uppercase hover:text-slate-400 transition-colors py-1 disabled:opacity-40"
                >
                  Use email code instead
                </button>
              </form>
            )}
          </div>

          <div className="props-reveal mt-10 space-y-3">
            <div className="h-px bg-slate-800" />
            {[
              'Revenue-based repayment — embedded in every transaction',
              'Real-time on-chain audit trail on Base mainnet',
              'Bulk contractor disbursement with CSV upload',
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-3 py-1">
                <span className="text-[10px] text-slate-700 font-mono mt-0.5 w-4 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                <p className="text-xs text-slate-600 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>

        </div>
      </div>
    </>
  )
}
