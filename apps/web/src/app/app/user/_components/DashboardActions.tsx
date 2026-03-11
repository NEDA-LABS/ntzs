'use client'

import { useRouter } from 'next/navigation'
import { ArrowUp, Wallet, Link2 } from 'lucide-react'

const glassBtn = [
  'group relative flex items-center justify-center gap-2',
  'h-12 w-full rounded-xl px-4',
  'bg-blue-950/50 backdrop-blur-md',
  'border border-t-white/20 border-x-white/[0.06] border-b-white/[0.04]',
  'text-sm font-semibold text-white/90',
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]',
  'transition-all duration-200',
  'hover:bg-blue-900/60 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14),0_0_20px_rgba(59,130,246,0.15)]',
  'active:scale-[0.97] active:bg-blue-950/70',
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
