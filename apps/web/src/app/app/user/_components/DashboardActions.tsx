'use client'

import { useRouter } from 'next/navigation'

export function DashboardActions() {
  const router = useRouter()

  return (
    <div className="grid grid-cols-3 gap-2">
      {/* Deposit */}
      <button
        type="button"
        onClick={() => router.push('/app/user/deposits/new')}
        className="group flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-zinc-900 shadow-lg shadow-white/5 transition-all duration-150 hover:shadow-white/10 active:scale-[0.97]"
      >
        <svg className="h-4 w-4 text-blue-600 transition-transform duration-150 group-hover:-translate-y-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-5 5m5-5l5 5" />
        </svg>
        Deposit
      </button>

      {/* Send (disabled) */}
      <button
        type="button"
        disabled
        className="flex items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm font-medium text-white/20 cursor-not-allowed"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
        </svg>
        Send
      </button>

      {/* Pay Me */}
      <button
        type="button"
        onClick={() => router.push('/app/user/wallet')}
        className="group flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-all duration-150 hover:shadow-blue-500/30 active:scale-[0.97]"
      >
        <svg className="h-4 w-4 transition-transform duration-150 group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
        </svg>
        Pay Me
      </button>
    </div>
  )
}
