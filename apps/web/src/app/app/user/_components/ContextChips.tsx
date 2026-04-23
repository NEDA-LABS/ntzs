"use client"

import { useMemo, useState } from "react"

interface ContextChipsProps {
  walletAddress?: string | null
  kycApproved?: boolean
  pendingCount?: number
}

export function ContextChips({ walletAddress, kycApproved, pendingCount }: ContextChipsProps) {
  const [copied, setCopied] = useState(false)
  const short = useMemo(() => walletAddress ? `${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}` : null, [walletAddress])

  async function copy() {
    if (!walletAddress) return
    await navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background/35 px-2.5 py-1 backdrop-blur-xl">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Base • Live
      </span>
      {short && (
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/35 px-3 py-1.5 font-mono text-foreground/85 backdrop-blur-xl hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring"
          title="Copy address"
        >
          {short}
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {copied && <span className="text-[10px] text-emerald-400">Copied</span>}
        </button>
      )}
      {kycApproved === false && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-amber-300 ring-1 ring-amber-500/20">
          Pending KYC
        </span>
      )}
      {typeof pendingCount === 'number' && pendingCount > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-amber-300 ring-1 ring-amber-500/20">
          {pendingCount} pending deposits
        </span>
      )}
    </div>
  )
}
