'use client'

import { useState, useTransition } from 'react'
import { Copy, Check, X, Loader2, Eye, EyeOff } from 'lucide-react'
import { createFundManagerCredentials } from '../actions'

interface FundManagerOption {
  id: string
  name: string
}

interface Credentials {
  email: string
  password: string
  name: string
}

export function CreateFmCredentials({ fundManagers }: { fundManagers: FundManagerOption[] }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [fmId, setFmId] = useState(fundManagers[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [isPending, startTransition] = useTransition()
  const [showPw, setShowPw] = useState(false)
  const [copied, setCopied] = useState<'email' | 'password' | 'all' | null>(null)

  function openModal() {
    setEmail('')
    setName('')
    setFmId(fundManagers[0]?.id ?? '')
    setError(null)
    setCredentials(null)
    setOpen(true)
  }

  function close() {
    if (isPending) return
    setOpen(false)
  }

  function copyText(text: string, field: 'email' | 'password' | 'all') {
    navigator.clipboard.writeText(text)
    setCopied(field)
    setTimeout(() => setCopied(null), 2000)
  }

  function handleSubmit() {
    setError(null)
    if (!email.trim()) { setError('Email is required.'); return }
    if (!fmId) { setError('Select a fund manager.'); return }

    const fd = new FormData()
    fd.append('email', email.trim().toLowerCase())
    fd.append('name', name.trim())
    fd.append('fundManagerId', fmId)

    startTransition(async () => {
      const result = await createFundManagerCredentials(fd)
      if (result.success) {
        setCredentials(result.credentials)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 active:scale-[0.98]"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Create Access
      </button>

      {open && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />

          {/* Modal */}
          <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <p className="font-semibold text-white">Create Fund Manager Access</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Pre-registers the account. Share credentials with the fund manager.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={isPending}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-zinc-400 transition hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5">
              {credentials ? (
                /* Credentials display */
                <div className="space-y-4">
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-3 ring-1 ring-emerald-500/20">
                    <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-xs font-medium text-emerald-400">
                      Account created. Share these credentials with the fund manager — the password will not be shown again.
                    </p>
                  </div>

                  <div className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">
                      Sign-in Credentials
                    </p>

                    {/* Email row */}
                    <div className="mb-3">
                      <p className="mb-1 text-[11px] text-zinc-600">Email</p>
                      <div className="flex items-center justify-between gap-2">
                        <code className="flex-1 truncate text-sm text-white">{credentials.email}</code>
                        <button
                          type="button"
                          onClick={() => copyText(credentials.email, 'email')}
                          className="shrink-0 text-zinc-500 transition hover:text-white"
                        >
                          {copied === 'email' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Password row */}
                    <div>
                      <p className="mb-1 text-[11px] text-zinc-600">Password</p>
                      <div className="flex items-center justify-between gap-2">
                        <code className="flex-1 truncate text-sm font-mono text-white">
                          {showPw ? credentials.password : '•'.repeat(credentials.password.length)}
                        </code>
                        <div className="flex shrink-0 items-center gap-2">
                          <button type="button" onClick={() => setShowPw(!showPw)} className="text-zinc-500 transition hover:text-white">
                            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => copyText(credentials.password, 'password')}
                            className="text-zinc-500 transition hover:text-white"
                          >
                            {copied === 'password' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => copyText(`Sign-in URL: ${typeof window !== 'undefined' ? window.location.origin : ''}/auth/sign-in\nEmail: ${credentials.email}\nPassword: ${credentials.password}`, 'all')}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 py-2.5 text-sm font-medium text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/10"
                  >
                    {copied === 'all' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    Copy all credentials
                  </button>

                  <p className="text-center text-[11px] text-zinc-600">
                    The fund manager signs up at /auth/sign-up using these credentials.
                  </p>
                </div>
              ) : (
                /* Form */
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-zinc-400">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(null) }}
                      placeholder="manager@firm.com"
                      disabled={isPending}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-zinc-400">Name (optional)</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Doe"
                      disabled={isPending}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-zinc-400">Fund Manager</label>
                    <select
                      value={fmId}
                      onChange={(e) => setFmId(e.target.value)}
                      disabled={isPending}
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500/50 disabled:opacity-50"
                    >
                      {fundManagers.map((fm) => (
                        <option key={fm.id} value={fm.id}>{fm.name}</option>
                      ))}
                    </select>
                  </div>

                  {error && (
                    <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{error}</p>
                  )}

                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isPending || !email || !fmId}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
                  >
                    {isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>
                    ) : (
                      'Generate Credentials'
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
