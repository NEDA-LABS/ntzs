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

// Bottom tab bar items for mobile (most reachable actions)
const bottomTabs = [
  { href: '/app/user', label: 'Home', icon: IconDashboard, exact: true },
  { href: '/app/user/deposits/new', label: 'Deposit', icon: IconPlus, exact: false },
  { href: '/app/user/wallet', label: 'Wallet', icon: IconWallet, exact: false },
  { href: '/app/user/activity', label: 'Activity', icon: IconActivity, exact: false },
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
      <aside className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:w-64 lg:flex-col border-r border-white/10 bg-black/70 backdrop-blur-xl">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-6">
          <Link href="/app/user" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
              <img src="/ntzs-logo.png" alt="nTZS" className="h-6 w-6 object-contain" />
            </div>
            <div>
              <p className="font-semibold text-white">nTZS</p>
              <p className="text-xs text-zinc-500">Digital Wallet</p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4 pb-28">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">Menu</p>
          <div className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-75 active:scale-[0.98] ${
                  isActive(item.href, item.href === '/app/user')
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            ))}
          </div>

          <p className="mb-3 mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">Rewards</p>
          <div className="space-y-1">
            {rewardItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-75 active:scale-[0.98] ${
                  isActive(item.href)
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
                {item.badge && (
                  <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20">
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </nav>

        {/* Wallet Status */}
        <div className="border-t border-white/10 p-4">
          <div className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
            <div className="flex items-center gap-3">
              <div className={`h-2.5 w-2.5 rounded-full ${wallet ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <div>
                <p className="text-sm font-medium text-white">{wallet ? 'Wallet Active' : 'Setup Required'}</p>
                <p className="text-xs text-zinc-500">
                  {wallet ? `${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}` : 'Create your wallet'}
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
