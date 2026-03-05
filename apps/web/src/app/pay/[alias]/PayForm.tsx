'use client'

import { useState } from 'react'
import { createPayLinkDeposit } from './actions'

const quickAmounts = [1000, 5000, 10000, 50000]

export function PayForm({ alias, displayName }: { alias: string; displayName: string }) {
  const [amount, setAmount] = useState('')
  const [phone, setPhone] = useState('')
  const [payerName, setPayerName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!amount || Number(amount) <= 0) {
      setError('Enter a valid amount')
      return
    }
    if (!phone) {
      setError('Enter your phone number')
      return
    }

    setLoading(true)
    const fd = new FormData()
    fd.set('amount', amount)
    fd.set('phone', phone)
    fd.set('payerName', payerName)

    const result = await createPayLinkDeposit(alias, fd)
    setLoading(false)

    if (result.success) {
      setDone(true)
    } else {
      setError(result.error)
    }
  }

  if (done) {
    return (
      <div className="py-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
          <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-white">Payment prompt sent</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Check your phone to approve the payment of{' '}
          <span className="font-semibold text-white">{Number(amount).toLocaleString()} TZS</span>{' '}
          to @{displayName}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Amount */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">Amount (TZS)</label>
        <input
          type="number"
          inputMode="numeric"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-3xl font-bold text-white placeholder:text-zinc-700 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        />
        <div className="mt-2 flex gap-2">
          {quickAmounts.map((qa) => (
            <button
              key={qa}
              type="button"
              onClick={() => setAmount(String(qa))}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10"
            >
              {qa >= 1000 ? `${qa / 1000}k` : qa}
            </button>
          ))}
        </div>
      </div>

      {/* Phone */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">Your phone number</label>
        <input
          type="tel"
          inputMode="tel"
          placeholder="07XX XXX XXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-base text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        />
      </div>

      {/* Payer name (optional) */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">Your name (optional)</label>
        <input
          type="text"
          placeholder="Jane"
          value={payerName}
          onChange={(e) => setPayerName(e.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-base text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        />
      </div>

      {error && (
        <p className="rounded-xl bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 active:scale-[0.97] disabled:opacity-70 disabled:cursor-not-allowed hover:shadow-blue-500/40"
      >
        {loading ? 'Sending...' : `Pay @${displayName}`}
      </button>
    </form>
  )
}
