'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function EnterpriseSignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [type, setType] = useState<'capital_lender' | 'disbursement_client' | ''>('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
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

  return (
    <>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .page-reveal  { animation: fadeIn 0.4s ease-out both; }
        .form-reveal  { animation: fadeUp 0.6s ease-out 0.2s both; }
      `}</style>

      <div className="page-reveal relative flex min-h-screen items-center justify-center font-mono px-6 py-16 bg-slate-950">
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(rgba(99,102,241,1) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,1) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />

        <div className="relative z-10 w-full max-w-sm">

          <div className="mb-10">
            <div className="flex items-center gap-3 mb-6">
              <span className="text-[10px] font-semibold tracking-[0.25em] text-slate-100 uppercase">n<span className="text-indigo-400">TZS</span></span>
              <div className="w-px h-3 bg-slate-700" />
              <span className="text-[10px] tracking-[0.2em] text-slate-500 uppercase">Enterprise</span>
            </div>
            <p className="text-2xl font-light text-slate-100">Request access.</p>
            <p className="mt-2 text-sm text-slate-500">
              Tell us about your organisation. We&apos;ll review and send you an invite link within one business day.
            </p>
          </div>

          {submitted ? (
            <div className="form-reveal border border-slate-800 bg-slate-900 p-8">
              <div className="border-l-2 border-indigo-500 pl-4 mb-6">
                <p className="text-sm font-semibold text-slate-100 mb-1">Request received.</p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  We&apos;ve notified the NEDApay team. Once approved, you&apos;ll receive an invite link at <span className="text-slate-300">{email}</span>.
                </p>
              </div>
              <Link
                href="/enterprise/login"
                className="block w-full text-center border border-slate-700 py-3 text-xs font-medium tracking-widest text-slate-500 uppercase transition-colors hover:border-indigo-500 hover:text-indigo-400"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="form-reveal border border-slate-800 bg-slate-900 p-8 space-y-5">

              <div>
                <label className="mb-2 block text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Organisation Name</label>
                <input
                  type="text"
                  autoFocus
                  placeholder="Ramani Ltd"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none font-mono transition-colors"
                />
              </div>

              <div>
                <label className="mb-2 block text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Business Email</label>
                <input
                  type="email"
                  placeholder="you@organisation.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none font-mono transition-colors"
                />
              </div>

              <div>
                <label className="mb-2 block text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Phone <span className="text-slate-700 normal-case">(optional)</span></label>
                <input
                  type="tel"
                  placeholder="+255 7XX XXX XXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none font-mono transition-colors"
                />
              </div>

              <div>
                <label className="mb-2 block text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Account Type</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'capital_lender', label: 'Capital Lender', sub: 'Deploy & recover capital via merchant repayments' },
                    { value: 'disbursement_client', label: 'Disbursement Client', sub: 'Bulk payments to contractors via CSV upload' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setType(opt.value as typeof type)}
                      className={`text-left border p-3 transition-colors ${type === opt.value ? 'border-indigo-500 bg-indigo-950' : 'border-slate-700 bg-slate-950 hover:border-slate-600'}`}
                    >
                      <p className={`text-[10px] font-semibold tracking-wider uppercase mb-1 ${type === opt.value ? 'text-indigo-400' : 'text-slate-400'}`}>{opt.label}</p>
                      <p className="text-[10px] text-slate-600 leading-relaxed">{opt.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={loading || !name.trim() || !email.trim() || !type}
                className="w-full bg-indigo-600 py-3 text-xs font-semibold tracking-widest text-white uppercase transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? 'Submitting...' : 'Request Access'}
              </button>

              <p className="text-center text-[10px] text-slate-600">
                Already have an account?{' '}
                <Link href="/enterprise/login" className="text-indigo-400 hover:text-indigo-300 transition-colors">Sign in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </>
  )
}
