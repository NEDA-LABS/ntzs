'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function InviteForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) setError('Missing invite token. Check your email link.')
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      const res = await fetch('/enterprise/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to set password')
      router.push('/enterprise/dashboard')
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
        .page-reveal { animation: fadeIn 0.4s ease-out both; }
        .form-reveal { animation: fadeUp 0.6s ease-out 0.2s both; }
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
            <p className="text-2xl font-light text-slate-100">Set your password.</p>
            <p className="mt-2 text-sm text-slate-500">Your account has been approved. Set a password to access your dashboard.</p>
          </div>

          <form onSubmit={handleSubmit} className="form-reveal border border-slate-800 bg-slate-900 p-8 space-y-5">
            <div>
              <label className="mb-2 block text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Password</label>
              <input
                type="password"
                autoFocus
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!token}
                className="w-full border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none font-mono transition-colors disabled:opacity-40"
              />
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Confirm Password</label>
              <input
                type="password"
                placeholder="Repeat password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={!token}
                className="w-full border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none font-mono transition-colors disabled:opacity-40"
              />
            </div>

            {error && <p className="border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading || !token || !password || !confirm}
              className="w-full bg-indigo-600 py-3 text-xs font-semibold tracking-widest text-white uppercase transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? 'Setting Password...' : 'Set Password & Enter Dashboard'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}

export default function InvitePage() {
  return (
    <Suspense>
      <InviteForm />
    </Suspense>
  )
}
