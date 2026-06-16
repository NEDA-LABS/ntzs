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

  const inputCls = 'w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-colors'
  const errorBox = error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>

  return (
    <>
      <style>{`
        @keyframes eRise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes eIn { from { opacity: 0; } to { opacity: 1; } }
        .e-rise-1 { animation: eRise 0.7s cubic-bezier(0.16,1,0.3,1) 0.05s both; }
        .e-rise-2 { animation: eRise 0.7s cubic-bezier(0.16,1,0.3,1) 0.18s both; }
        .e-rise-3 { animation: eRise 0.7s cubic-bezier(0.16,1,0.3,1) 0.30s both; }
        .e-fade   { animation: eIn 0.6s ease-out 0.1s both; }
      `}</style>

      <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-[#FBF8F3] text-stone-900">

        {/* ── Story panel ─────────────────────────────────────────── */}
        <aside
          className="relative hidden lg:flex flex-col justify-between overflow-hidden px-14 py-12"
          style={{ background: 'linear-gradient(135deg, #FBF1E6 0%, #FBF8F3 46%, #EEEAFF 100%)' }}
        >
          <div aria-hidden className="pointer-events-none absolute -top-28 -right-24 h-96 w-96 rounded-full bg-indigo-300/30 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-16 h-80 w-80 rounded-full bg-amber-300/25 blur-3xl" />

          <div className="e-fade relative flex items-center gap-2.5 text-[11px] tracking-[0.25em] uppercase text-stone-500">
            <span>n<span className="font-semibold text-indigo-600">TZS</span></span>
            <span className="h-3 w-px bg-stone-300" />
            <span>Enterprise</span>
          </div>

          <div className="relative max-w-md">
            <h1 className="e-rise-1 text-[2.6rem] xl:text-5xl font-semibold tracking-tight leading-[1.08] text-stone-900">
              Fund the sale.<br />
              <span className="text-indigo-600">Pay the people.</span>
            </h1>
            <p className="e-rise-2 mt-5 text-[15px] leading-relaxed text-stone-600">
              Programmable TZS that moves with your business — capital that repays itself as you sell,
              and contractor payouts that clear in a single run.
            </p>

            <div className="e-rise-3 mt-10 space-y-5">
              <ValueProp
                title="For capital lenders"
                body="Deploy capital that repays itself from every sale — with proof you can audit."
              />
              <ValueProp
                title="For disbursement partners"
                body="Pay all your contractors in one batch — by mobile money or bank."
              />
            </div>
          </div>

          <p className="e-fade relative text-xs text-stone-400">
            Settled in TZS · Audit-ready by default
          </p>
        </aside>

        {/* ── Form panel ──────────────────────────────────────────── */}
        <main className="flex items-center justify-center px-6 py-12">
          <div className="e-rise-2 w-full max-w-sm">

            {/* Mobile brand (story panel is hidden < lg) */}
            <div className="lg:hidden mb-8">
              <div className="flex items-center gap-2.5 text-[11px] tracking-[0.25em] uppercase text-stone-500 mb-4">
                <span>n<span className="font-semibold text-indigo-600">TZS</span></span>
                <span className="h-3 w-px bg-stone-300" />
                <span>Enterprise</span>
              </div>
              <h1 className="text-3xl font-semibold tracking-tight leading-tight text-stone-900">
                Fund the sale. <span className="text-indigo-600">Pay the people.</span>
              </h1>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-white p-8 shadow-[0_24px_60px_-28px_rgba(40,30,20,0.25)]">

              {/* Email step */}
              {step === 'email' && (
                <form onSubmit={handleEmailSubmit} className="space-y-5">
                  <div>
                    <h2 className="text-lg font-semibold text-stone-900">Sign in to your portal</h2>
                    <p className="mt-1 text-xs text-stone-500">Lenders and disbursement partners, same place.</p>
                  </div>
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
                      Organisation email
                    </label>
                    <input type="email" autoFocus placeholder="you@organisation.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} className={inputCls} />
                  </div>

                  {errorBox}

                  <button type="submit" disabled={loading || !email.trim()}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">
                    {loading ? 'Sending code…' : 'Send email code'}
                  </button>

                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-stone-200" />
                    <span className="text-[10px] uppercase tracking-widest text-stone-400">or</span>
                    <div className="h-px flex-1 bg-stone-200" />
                  </div>

                  <button type="button" disabled={!email.trim()} onClick={() => { setError(''); setStep('password') }}
                    className="w-full rounded-xl border border-stone-300 py-3 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40">
                    Sign in with password
                  </button>

                  <p className="text-center text-xs text-stone-500">
                    New organisation?{' '}
                    <Link href="/enterprise/signup" className="font-medium text-indigo-600 hover:text-indigo-700">Request access</Link>
                  </p>
                </form>
              )}

              {/* OTP step */}
              {step === 'otp' && (
                <form onSubmit={handleOtpSubmit} className="space-y-5">
                  <div>
                    <p className="text-xs text-stone-500">Code sent to</p>
                    <p className="mt-0.5 text-sm font-semibold text-stone-900">{email}</p>
                    <button type="button" onClick={() => { setStep('email'); setCode(''); setError('') }}
                      className="mt-2 text-[11px] uppercase tracking-wide text-stone-400 hover:text-stone-600">
                      Change email
                    </button>
                  </div>

                  <div>
                    <label className="mb-2 block text-[11px] font-semibold tracking-wide text-stone-500 uppercase">6-digit code</label>
                    <input type="text" inputMode="numeric" autoFocus maxLength={6} placeholder="000000" value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      className={`${inputCls} text-center font-mono text-2xl font-bold tracking-[0.4em] text-indigo-600`} />
                  </div>

                  {errorBox}

                  <button type="submit" disabled={loading || code.length < 6}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">
                    {loading ? 'Verifying…' : 'Sign in'}
                  </button>
                </form>
              )}

              {/* Password step */}
              {step === 'password' && (
                <form onSubmit={handlePasswordSubmit} className="space-y-5">
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Signing in as</p>
                    <div className="flex items-center justify-between rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5">
                      <span className="truncate text-sm text-stone-700">{email}</span>
                      <button type="button" onClick={() => { setStep('email'); setPassword(''); setError('') }}
                        className="ml-3 shrink-0 text-[11px] uppercase tracking-wide text-stone-400 hover:text-stone-600">
                        Change
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-[11px] font-semibold tracking-wide text-stone-500 uppercase">Password</label>
                    <input type="password" autoFocus placeholder="••••••••" value={password}
                      onChange={(e) => setPassword(e.target.value)} className={inputCls} />
                  </div>

                  {errorBox}

                  <button type="submit" disabled={loading || !password}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">
                    {loading ? 'Signing in…' : 'Sign in'}
                  </button>

                  <button type="button" disabled={loading}
                    onClick={async () => {
                      setError(''); setLoading(true)
                      try {
                        await fetch('/enterprise/api/auth/request-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
                        setPassword(''); setStep('otp')
                      } catch { setError('Failed to send code') } finally { setLoading(false) }
                    }}
                    className="w-full py-1 text-[11px] uppercase tracking-wide text-stone-400 transition-colors hover:text-stone-600 disabled:opacity-40">
                    Use email code instead
                  </button>
                </form>
              )}
            </div>

            <p className="mt-5 text-center text-xs text-stone-400">
              One sign-in for <span className="text-stone-600">capital lenders</span> &amp; <span className="text-stone-600">disbursement partners</span>
            </p>
          </div>
        </main>
      </div>
    </>
  )
}

function ValueProp({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-3.5">
      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100">
        <svg className="h-3.5 w-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-semibold text-stone-900">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-stone-600">{body}</p>
      </div>
    </div>
  )
}
