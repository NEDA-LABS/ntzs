'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  IconActivity,
  IconDashboard,
  IconPlus,
  IconSparkles,
  IconUsers,
  IconWallet,
} from '@/app/app/_components/icons'

const navItems = [
  { href: '/app/user', label: 'Dashboard', icon: IconDashboard },
  { href: '/app/user/wallet', label: 'Wallet', icon: IconWallet },
  { href: '/app/user/deposits/new', label: 'Deposit', icon: IconPlus },
  { href: '/app/user/activity', label: 'Activity', icon: IconActivity },
]

const rewardItems = [
  { href: '/app/user/stake', label: 'Stake to Earn', icon: IconSparkles, badge: 'NEW' },
  { href: '/app/user/invite', label: 'Invite & Earn', icon: IconUsers },
]

// Bottom tab bar items for mobile — Deposit stays in the centre
const bottomTabs = [
  { href: '/app/user', label: 'Home', icon: IconDashboard, exact: true },
  { href: '/app/user/wallet', label: 'Wallet', icon: IconWallet, exact: false },
  { href: '/app/user/deposits/new', label: 'Deposit', icon: IconPlus, exact: false },
  { href: '/app/user/activity', label: 'Activity', icon: IconActivity, exact: false },
  { href: '/app/user/stake', label: 'Stake', icon: IconSparkles, exact: false },
]

interface MobileSidebarProps {
  wallet: { address: string } | null
}

export function MobileSidebar({ wallet }: MobileSidebarProps) {
  const pathname = usePathname()

  const isActive = (href: string, exact = false) => {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* ── Desktop sidebar (lg+) ─────────────────────────────────────── */}
      <aside className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:w-64 lg:flex-col border-r border-white/[0.06] bg-[#0c0c12]">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-white/[0.06] px-5">
          <Link href="/app/user" prefetch className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-white/10">
              <img src="/ntzs-logo.png" alt="nTZS" className="h-5 w-5 object-contain" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">nTZS</p>
              <p className="text-[11px] text-zinc-600">Digital Wallet</p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 pb-28">
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Menu</p>
          <div className="space-y-0.5">
            {navItems.map((item) => {
              const active = isActive(item.href, item.href === '/app/user')
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-100 active:scale-[0.98] ${
                    active
                      ? 'bg-white/[0.08] text-white'
                      : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                  }`}
                >
                  <item.icon className={`h-4.5 w-4.5 ${active ? 'text-white' : 'text-zinc-500'}`} />
                  {item.label}
                  {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-400" />}
                </Link>
              )
            })}
          </div>

          <p className="mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Rewards</p>
          <div className="space-y-0.5">
            {rewardItems.map((item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-100 active:scale-[0.98] ${
                    active
                      ? 'bg-white/[0.08] text-white'
                      : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                  }`}
                >
                  <item.icon className={`h-4.5 w-4.5 ${active ? 'text-white' : 'text-zinc-500'}`} />
                  {item.label}
                  {item.badge && (
                    <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
                      {item.badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        </nav>

        {/* Wallet Status */}
        <div className="border-t border-white/[0.06] p-3">
          <div className="rounded-xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className={`h-2 w-2 rounded-full ${wallet ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-amber-400'}`} />
              <div className="min-w-0">
                <p className="text-xs font-medium text-white">{wallet ? 'Wallet Active' : 'Setup Required'}</p>
                <p className="truncate text-[10px] text-zinc-600 font-mono">
                  {wallet ? `${wallet.address.slice(0, 10)}...${wallet.address.slice(-6)}` : 'Create your wallet'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Mobile bottom tab bar (< lg) ─────────────────────────────── */}
      <nav className="fixed bottom-0 inset-x-0 z-50 lg:hidden border-t border-white/10 bg-black/80 backdrop-blur-xl">
        <div className="flex items-stretch h-16 safe-area-inset-bottom">
          {bottomTabs.map((tab) => {
            const active = isActive(tab.href, tab.exact)
            const isDeposit = tab.href.includes('deposits')
            return (
              <Link
                key={tab.href}
                href={tab.href}
                prefetch
                className={`flex flex-1 flex-col items-center justify-center gap-1 transition-colors active:scale-95 ${
                  isDeposit
                    ? 'relative'
                    : active
                    ? 'text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {isDeposit ? (
                  <span className={`flex h-11 w-11 items-center justify-center rounded-2xl shadow-lg transition-colors ${
                    active ? 'bg-white' : 'bg-violet-600 hover:bg-violet-500'
                  }`}>
                    <tab.icon className={`h-5 w-5 ${active ? 'text-black' : 'text-white'}`} />
                  </span>
                ) : (
                  <>
                    <tab.icon className="h-5 w-5" />
                    <span className="text-[10px] font-medium">{tab.label}</span>
                  </>
                )}
                {isDeposit && (
                  <span className="text-[10px] font-medium text-zinc-400 mt-0.5">{tab.label}</span>
                )}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
