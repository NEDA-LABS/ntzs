'use client'

import { useState } from 'react'

export function GasAddressCopy({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
      <span className="flex-1 truncate font-mono text-xs text-zinc-300">{address}</span>
      <button
        onClick={copy}
        className="shrink-0 rounded-md bg-white/5 px-2 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
