'use client'

import { useRouter } from 'next/navigation'
import { ArrowUp, Wallet, Link2 } from 'lucide-react'

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

export function DashboardActions() {
  const router = useRouter()

  return (
    <div className="grid grid-cols-3 gap-3">
      {/* Deposit */}
      <button type="button" onClick={() => router.push('/app/user/deposits/new')} className={glassBtn}>
        <span className="pointer-events-none absolute inset-0 translate-x-[-100%] bg-[linear-gradient(110deg,transparent_25%,rgba(255,255,255,0.06)_50%,transparent_75%)] transition-transform duration-500 group-hover:translate-x-[100%]" />
        <ArrowUp className="h-4 w-4 text-blue-300" />
        Deposit
      </button>

      {/* Save */}
      <button type="button" onClick={() => router.push('/app/user/stake')} className={glassBtn}>
        <span className="pointer-events-none absolute inset-0 translate-x-[-100%] bg-[linear-gradient(110deg,transparent_25%,rgba(255,255,255,0.06)_50%,transparent_75%)] transition-transform duration-500 group-hover:translate-x-[100%]" />
        <Wallet className="h-4 w-4 text-emerald-400" />
        Save
      </button>

      {/* Pay Me */}
      <button type="button" onClick={() => router.push('/app/user/wallet')} className={glassBtn}>
        <span className="pointer-events-none absolute inset-0 translate-x-[-100%] bg-[linear-gradient(110deg,transparent_25%,rgba(255,255,255,0.06)_50%,transparent_75%)] transition-transform duration-500 group-hover:translate-x-[100%]" />
        <Link2 className="h-4 w-4 text-blue-300" />
        Pay Me
      </button>
    </div>
  )
}
