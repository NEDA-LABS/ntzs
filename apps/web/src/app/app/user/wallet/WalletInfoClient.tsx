'use client'

import { useState } from 'react'

interface WalletInfoClientProps {
  address: string
}

export function WalletInfoClient({ address }: WalletInfoClientProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Wallet Address</p>
          <p className="mt-2 break-all font-mono text-sm leading-relaxed text-white">
            {address}
          </p>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-150 active:scale-95 ${
            copied
              ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
              : 'bg-white/10 text-white hover:bg-white/15'
          }`}
        >
          {copied ? (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy address
            </>
          )}
        </button>
      </div>

      {/* Info row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-xs text-zinc-500">Network</p>
          <p className="mt-1 text-sm font-semibold text-white">Base</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-xs text-zinc-500">Status</p>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <p className="text-sm font-semibold text-white">Active</p>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-xs text-zinc-500">Managed by</p>
          <p className="mt-1 text-sm font-semibold text-white">nTZS</p>
        </div>
      </div>

      {/* Notice */}
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <p className="text-xs text-zinc-400 leading-relaxed">
          This is your nTZS wallet address on the Base network. Share it to receive nTZS tokens. Only send nTZS-compatible tokens to this address.
        </p>
      </div>
    </div>
  )
}
