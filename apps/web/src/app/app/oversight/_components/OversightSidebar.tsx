'use client'

import { useEffect, useState } from 'react'

const SECTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    id: 'reserves',
    label: 'Reserves',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
  },
  {
    id: 'issuance',
    label: 'Daily Issuance',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    id: 'kyc',
    label: 'KYC & Pipeline',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
  {
    id: 'deposits',
    label: 'Deposit Activity',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15M9 12l3 3m0 0l3-3m-3 3V2.25" />
      </svg>
    ),
  },
  {
    id: 'withdrawals',
    label: 'Withdrawals',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
      </svg>
    ),
  },
  {
    id: 'audit',
    label: 'Audit Trail',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
  {
    id: 'contract',
    label: 'Smart Contract',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

interface OversightSidebarProps {
  isDark: boolean
  onToggle: () => void
}

export function OversightSidebar({ isDark, onToggle }: OversightSidebarProps) {
  const [active, setActive] = useState('overview')
  const d = isDark

  useEffect(() => {
    const onScroll = () => {
      let current = SECTIONS[0].id
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= 100) current = s.id
      }
      setActive(current)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Theme tokens
  const bg        = d ? 'bg-black'              : 'bg-white'
  const border    = d ? 'rgba(255,255,255,0.06)' : 'rgb(229,231,235)'
  const hdrLabel  = d ? 'text-white'             : 'text-gray-900'
  const hdrSub    = d ? 'text-zinc-600'          : 'text-gray-400'
  const navLabel  = d ? 'text-zinc-700'          : 'text-gray-400'
  const activeBtn = d ? 'bg-white/[0.06] text-white'                         : 'bg-gray-100 text-gray-900'
  const inactiveBtn = d ? 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-700'
  const activeIcon = d ? 'text-white'            : 'text-gray-900'
  const inactiveIcon = d ? 'text-zinc-600'       : 'text-gray-400'
  const activeDot = d ? 'bg-blue-400'            : 'bg-blue-500'
  const liveCard  = d ? 'bg-white/[0.03]'        : 'bg-gray-50'
  const liveTxt   = d ? 'text-zinc-500'          : 'text-gray-500'
  const footerCard = d ? 'bg-white/[0.03]'       : 'bg-gray-50'
  const footerName = d ? 'text-zinc-300'         : 'text-gray-700'
  const footerSub  = d ? 'text-zinc-600'         : 'text-gray-400'
  const toggleBg   = d ? 'hover:bg-white/[0.05]' : 'hover:bg-gray-100'
  const toggleTxt  = d ? 'text-zinc-500 hover:text-zinc-300' : 'text-gray-400 hover:text-gray-600'

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 hidden w-60 flex-col ${bg} lg:flex`}
      style={{ borderRight: `1px solid ${border}` }}
    >

      {/* Header */}
      <div className="px-5 py-6" style={{ borderBottom: `1px solid ${border}` }}>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600/20" style={{ border: '1px solid rgba(99,102,241,0.3)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 text-indigo-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
          <div>
            <div className={`font-mono text-sm font-bold tracking-wider ${hdrLabel}`}>Oversight</div>
            <div className={`font-mono text-[9px] tracking-widest uppercase ${hdrSub}`}>Operations Portal</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-4 py-5">
        <div className={`mb-3 px-1 font-mono text-[9px] tracking-widest uppercase ${navLabel}`}>Navigation</div>
        <div className="space-y-0.5">
          {SECTIONS.map(s => {
            const isActive = active === s.id
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
                  isActive ? activeBtn : inactiveBtn
                }`}
              >
                <span className={isActive ? activeIcon : inactiveIcon}>{s.icon}</span>
                <span className="font-mono text-xs tracking-wide">{s.label}</span>
                {isActive && <span className={`ml-auto h-1 w-1 rounded-full ${activeDot}`} />}
              </button>
            )
          })}
        </div>

        {/* Live data card */}
        <div className={`mt-6 rounded-xl p-4 ${liveCard}`} style={{ border: `1px solid ${border}` }}>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-xs font-semibold text-emerald-400">Live Data</span>
          </div>
          <p className={`mt-2 font-mono text-[10px] leading-relaxed ${liveTxt}`}>
            All metrics update in real-time from blockchain and database.
          </p>
        </div>
      </nav>

      {/* Theme toggle + Footer */}
      <div className="px-4 pb-4 pt-3" style={{ borderTop: `1px solid ${border}` }}>

        {/* Theme toggle button */}
        <button
          onClick={onToggle}
          className={`mb-3 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 transition-colors ${toggleBg} ${toggleTxt}`}
        >
          {d ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
            </svg>
          )}
          <span className="font-mono text-[10px] tracking-widest uppercase">
            {d ? 'Light mode' : 'Dark mode'}
          </span>
        </button>

        {/* Brand card */}
        <div className={`rounded-xl px-4 py-3 ${footerCard}`} style={{ border: `1px solid ${border}` }}>
          <div className={`font-mono text-xs font-semibold ${footerName}`}>nTZS Stablecoin</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <div className="h-1 w-1 rounded-full bg-blue-400" />
            <span className={`font-mono text-[9px] tracking-widest uppercase ${footerSub}`}>Base Mainnet</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
