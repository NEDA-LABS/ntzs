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
        className="group flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-150 hover:shadow-blue-500/40 active:scale-[0.97]"
      >
        <svg className="h-4 w-4 transition-transform duration-150 group-hover:-translate-y-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-5 5m5-5l5 5" />
        </svg>
        Deposit
      </button>

      {/* Save */}
      <button
        type="button"
        onClick={() => router.push('/app/user/stake')}
        className="group flex items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white/60 transition-all duration-150 hover:bg-white/[0.06] hover:text-white/80 hover:shadow-lg hover:shadow-white/5 active:scale-[0.97]"
      >
        <svg className="h-4 w-4 text-emerald-400 transition-transform duration-150 group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a9 9 0 019-9h.75c.831 0 1.5.669 1.5 1.5v.75H18a.75.75 0 00.75-.75V18.75a3 3 0 01-3 3h-15a3 3 0 01-3-3V9.75a.75.75 0 01.75-.75h9.75" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75v3m0 0l3-3m-3 3l-3-3" />
        </svg>
        Save
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
