'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PartnerSignupPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    businessName: '',
    email: '',
    password: '',
    webhookUrl: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ apiKey: string; partnerId: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/v1/partners/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Signup failed')
        return
      }

      setResult({ apiKey: data.apiKey, partnerId: data.partnerId })
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-lg px-6 py-20">
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
            <svg className="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold tracking-tight">You&apos;re in!</h1>
          <p className="mt-2 text-sm text-white/60">
            Your partner account has been created. Here&apos;s your API key &mdash; save it now, you won&apos;t see it again.
          </p>

          <div className="mt-6">
            <label className="text-xs font-medium text-white/50">Your API Key</label>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-sm text-emerald-300">
                {result.apiKey}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(result.apiKey)}
                className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-xs text-white/70 hover:bg-white/10"
              >
                Copy
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200/80">
            <span className="font-semibold text-amber-300">Important:</span> Store this key securely. It cannot be retrieved later.
            If lost, you&apos;ll need to generate a new one from the dashboard.
          </div>

          <div className="mt-8 flex gap-3">
            <button
              onClick={() => router.push('/developers/dashboard')}
              className="flex-1 rounded-full bg-white py-3 text-sm font-semibold text-black hover:bg-white/90"
            >
              Go to Dashboard
            </button>
            <button
              onClick={() => router.push('/developers')}
              className="flex-1 rounded-full border border-white/15 bg-white/5 py-3 text-sm text-white/80 hover:bg-white/10"
            >
              Read the Docs
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-20">
      <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
        <h1 className="text-2xl font-bold tracking-tight">Create a partner account</h1>
        <p className="mt-2 text-sm text-white/60">
          Get your API key and start integrating nTZS payments into your app.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="businessName" className="block text-xs font-medium text-white/50">
              Business Name
            </label>
            <input
              id="businessName"
              type="text"
              required
              placeholder="PayPerPlay"
              value={form.businessName}
              onChange={(e) => setForm({ ...form, businessName: e.target.value })}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/10"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-xs font-medium text-white/50">
              Business Email
            </label>
            <input
              id="email"
              type="email"
              required
              placeholder="team@payperplay.xyz"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/10"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-white/50">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              placeholder="Min. 8 characters"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/10"
            />
          </div>

          <div>
            <label htmlFor="webhookUrl" className="block text-xs font-medium text-white/50">
              Webhook URL <span className="text-white/30">(optional)</span>
            </label>
            <input
              id="webhookUrl"
              type="url"
              placeholder="https://api.yourapp.com/webhooks/ntzs"
              value={form.webhookUrl}
              onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/10"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-white py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create account & get API key'}
          </button>

          <p className="text-center text-xs text-white/40">
            Already have an account?{' '}
            <a href="/developers/login" className="text-white/70 hover:text-white">
              Log in
            </a>
          </p>
        </form>
      </div>
    </div>
  )
}
