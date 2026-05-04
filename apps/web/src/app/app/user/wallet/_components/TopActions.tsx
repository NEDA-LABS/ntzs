"use client"

import { TrendingUp, Send, ArrowDown } from "lucide-react"

const glassBtn = [
  'group relative flex items-center justify-center gap-2',
  'h-12 w-full rounded-full px-4',
  'ntzs-wallet-pill border border-border/40 bg-background/35 backdrop-blur-2xl',
  'text-sm font-semibold text-foreground',
  'transition-all duration-200',
  'hover:opacity-90 active:scale-[0.97]',
  'focus-visible:outline-none focus:ring-2 focus:ring-ring',
  'overflow-hidden',
].join(' ')

function emit(name: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(name))
  }
}

export function TopActions() {
  return (
    <div className="grid grid-cols-3 gap-3">
      <button type="button" onClick={() => emit('wallet:openSwap')} className={glassBtn}>
        <span className="pointer-events-none absolute inset-0 translate-x-[-100%] bg-[linear-gradient(110deg,transparent_25%,rgba(255,255,255,0.06)_50%,transparent_75%)] transition-transform duration-500 group-hover:translate-x-[100%]" />
        <TrendingUp className="h-4 w-4 text-violet-400" />
        Swap
      </button>

      <button type="button" onClick={() => emit('wallet:openSend')} className={glassBtn}>
        <span className="pointer-events-none absolute inset-0 translate-x-[-100%] bg-[linear-gradient(110deg,transparent_25%,rgba(255,255,255,0.06)_50%,transparent_75%)] transition-transform duration-500 group-hover:translate-x-[100%]" />
        <Send className="h-4 w-4 text-emerald-400" />
        Send
      </button>

      <button type="button" onClick={() => emit('wallet:openWithdraw')} className={glassBtn}>
        <span className="pointer-events-none absolute inset-0 translate-x-[-100%] bg-[linear-gradient(110deg,transparent_25%,rgba(255,255,255,0.06)_50%,transparent_75%)] transition-transform duration-500 group-hover:translate-x-[100%]" />
        <ArrowDown className="h-4 w-4 text-blue-300" />
        Withdraw
      </button>
    </div>
  )
}
