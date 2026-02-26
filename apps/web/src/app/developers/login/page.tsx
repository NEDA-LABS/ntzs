'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PartnerLoginPage() {
  const router = useRouter()
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/v1/partners/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }

      // Store session token
      document.cookie = `partner_session=${data.token}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=strict`
      router.push('/developers/dashboard')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-20">
      <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
        <h1 className="text-2xl font-bold tracking-tight">Partner Login</h1>
        <p className="mt-2 text-sm text-white/60">
          Sign in to your developer dashboard.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
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
              placeholder="Your password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
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
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <p className="text-center text-xs text-white/40">
            Don&apos;t have an account?{' '}
            <a href="/developers/signup" className="text-white/70 hover:text-white">
              Create one
            </a>
          </p>
        </form>
      </div>
    </div>
  )
}
