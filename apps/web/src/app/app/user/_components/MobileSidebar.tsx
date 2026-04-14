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
      <aside className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:w-64 lg:flex-col border-r border-border/40 bg-background/35 backdrop-blur-2xl">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-border/40 px-5">
          <Link href="/app/user" prefetch className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-white/10">
              <img src="/ntzs-logo.png" alt="nTZS" className="h-5 w-5 object-contain" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">nTZS</p>
              <p className="text-[11px] text-muted-foreground">Digital Wallet</p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 pb-28">
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Menu</p>
          <div className="space-y-0.5">
            {navItems.map((item) => {
              const active = isActive(item.href, item.href === '/app/user')
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-100 active:scale-[0.98] ${
                    active
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-card/40 hover:text-foreground'
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
                  )}
                  <item.icon className={`h-4 w-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                  {item.label}
                  {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                </Link>
              )
            })}
          </div>

          <p className="mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Rewards</p>
          <div className="space-y-0.5">
            {rewardItems.map((item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-100 active:scale-[0.98] ${
                    active
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-card/40 hover:text-foreground'
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
                  )}
                  <item.icon className={`h-4 w-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
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
        <div className="border-t border-border/40 p-3">
          <div className="rounded-xl border border-border/40 bg-background/35 px-4 py-3 backdrop-blur-2xl">
            <div className="flex items-center gap-3">
              <div className={`h-2 w-2 rounded-full ${wallet ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-amber-400'}`} />
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">{wallet ? 'Wallet Active' : 'Setup Required'}</p>
                <p className="truncate text-[10px] text-muted-foreground font-mono">
                  {wallet ? `${wallet.address.slice(0, 10)}...${wallet.address.slice(-6)}` : 'Create your wallet'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Mobile bottom tab bar (< lg) ─────────────────────────────── */}
      <style>{`
        @property --deposit-angle {
          syntax: "<angle>";
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes deposit-spin {
          to { --deposit-angle: 360deg; }
        }
        .deposit-shiny-ring {
          background:
            linear-gradient(#1e3a8a, #1d4ed8) padding-box,
            conic-gradient(
              from var(--deposit-angle),
              transparent 0%,
              #60a5fa 15%,
              #ffffff 30%,
              #93c5fd 45%,
              transparent 55%
            ) border-box;
          border: 2px solid transparent;
          animation: deposit-spin 2.4s linear infinite;
        }
        .deposit-shiny-ring::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: radial-gradient(circle at 50% 0%, rgba(147,197,253,0.35) 0%, transparent 65%);
          pointer-events: none;
        }
      `}</style>

      <nav className="fixed bottom-0 inset-x-0 z-50 lg:hidden">
        <div className="absolute inset-0 border-t border-border/40 bg-background/80 backdrop-blur-2xl" />
        <div className="relative flex items-end h-[72px] pb-2">
          {bottomTabs.map((tab) => {
            const active = isActive(tab.href, tab.exact)
            const isDeposit = tab.href.includes('deposits')

            if (isDeposit) {
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  prefetch
                  className="flex flex-1 flex-col items-center justify-end gap-1 active:scale-95 transition-transform"
                >
                  <span className="deposit-shiny-ring relative flex h-[52px] w-[52px] -translate-y-3 items-center justify-center rounded-2xl shadow-[0_0_20px_rgba(59,130,246,0.4)]">
                    <tab.icon className="relative z-10 h-6 w-6 text-white" />
                  </span>
                  <span className="text-[11px] font-semibold -mt-1 text-blue-300">{tab.label}</span>
                </Link>
              )
            }

            return (
              <Link
                key={tab.href}
                href={tab.href}
                prefetch
                className="flex flex-1 flex-col items-center justify-end gap-1 pb-0.5 active:scale-95 transition-transform"
              >
                <span className={`relative flex h-[38px] w-[38px] items-center justify-center rounded-xl transition-all duration-200 ${
                  active ? 'bg-primary/15' : ''
                }`}>
                  {active && (
                    <span className="absolute -top-px left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_6px_rgba(96,165,250,0.8)]" />
                  )}
                  <tab.icon className={`h-[22px] w-[22px] transition-colors duration-200 ${
                    active ? 'text-primary' : 'text-muted-foreground'
                  }`} />
                </span>
                <span className={`text-[11px] font-medium transition-colors duration-200 ${
                  active ? 'text-primary' : 'text-muted-foreground'
                }`}>
                  {tab.label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
