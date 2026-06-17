'use client'

import { useState } from 'react'
import Link from 'next/link'

import { EnterpriseAuthStyles, EnterpriseStoryAside, EnterpriseMobileBrand } from '../_components/story-panel'

export default function EnterpriseSignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [type, setType] = useState<'capital_lender' | 'disbursement_client' | ''>('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    if (!name.trim() || !email.trim() || !type) return
    setLoading(true)
    try {
      const res = await fetch('/enterprise/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim() || undefined, type }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Signup failed')
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-colors'

  return (
    <>
      <EnterpriseAuthStyles />

      <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-[#FBF8F3] text-stone-900">
        <EnterpriseStoryAside />

        {/* Form panel */}
        <main className="flex items-center justify-center px-6 py-12">
          <div className="e-rise-2 w-full max-w-sm">
            <EnterpriseMobileBrand />

            {submitted ? (
              <div>
                <div className="mb-6 border-l-2 border-indigo-500 pl-4">
                  <p className="mb-1 text-sm font-semibold text-stone-900">Request received.</p>
                  <p className="text-xs leading-relaxed text-stone-500">
                    We&apos;ve notified the NEDApay team. Once approved, you&apos;ll get an invite link at <span className="text-stone-700">{email}</span> — usually within one business day.
                  </p>
                </div>
                <Link href="/enterprise/login"
                  className="block w-full rounded-xl border border-stone-300 py-3 text-center text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900">
                  Back to sign in
                </Link>
              </div>
            ) : (
              <div>
                <div className="mb-5">
                  <h2 className="text-lg font-semibold text-stone-900">Request access</h2>
                  <p className="mt-1 text-xs text-stone-500">Tell us about your organisation — we&apos;ll review and send an invite link within one business day.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold tracking-wide text-stone-500 uppercase">Organisation name</label>
                    <input type="text" autoFocus placeholder="Business Name Ltd" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                  </div>

                  <div>
                    <label className="mb-2 block text-[11px] font-semibold tracking-wide text-stone-500 uppercase">Business email</label>
                    <input type="email" placeholder="you@organisation.com" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
                  </div>

                  <div>
                    <label className="mb-2 block text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
                      Phone <span className="normal-case text-stone-400">(optional)</span>
                    </label>
                    <input type="tel" placeholder="+255 7XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
                  </div>

                  <div>
                    <label className="mb-2 block text-[11px] font-semibold tracking-wide text-stone-500 uppercase">Account type</label>
                    <div className="grid grid-cols-1 gap-3">
                      {[
                        { value: 'capital_lender', label: 'Capital Lender', sub: 'Deploy capital and recover it through merchant repayments.' },
                        { value: 'disbursement_client', label: 'Disbursement Partner', sub: 'Pay contractors in bulk — by mobile money or bank.' },
                      ].map(opt => (
                        <button key={opt.value} type="button" onClick={() => setType(opt.value as typeof type)}
                          className={`rounded-xl border p-3.5 text-left transition-colors ${type === opt.value ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/15' : 'border-stone-300 bg-white hover:border-stone-400'}`}>
                          <p className={`text-sm font-semibold ${type === opt.value ? 'text-indigo-700' : 'text-stone-800'}`}>{opt.label}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{opt.sub}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

                  <button type="submit" disabled={loading || !name.trim() || !email.trim() || !type}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">
                    {loading ? 'Submitting…' : 'Request access'}
                  </button>

                  <p className="text-center text-xs text-stone-500">
                    Already have an account?{' '}
                    <Link href="/enterprise/login" className="font-medium text-indigo-600 hover:text-indigo-700">Sign in</Link>
                  </p>
                </form>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
