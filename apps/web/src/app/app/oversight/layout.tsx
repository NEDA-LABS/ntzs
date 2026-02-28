import type { ReactNode } from 'react'
import Link from 'next/link'

import { requireAnyRole } from '@/lib/auth/rbac'
import {
  IconDashboard,
  IconBarChart,
  IconShieldCheck,
  IconFileText,
  IconUsers,
  IconDatabase,
  IconSettings,
  IconCoins,
} from '@/app/app/_components/icons'

const navItems = [
  { href: '/app/oversight#overview', label: 'Overview', icon: IconDashboard },
  { href: '/app/oversight#reserves', label: 'Reserves', icon: IconDatabase },
  { href: '/app/oversight#issuance', label: 'Daily Issuance', icon: IconBarChart },
  { href: '/app/oversight#deposits', label: 'Deposit Activity', icon: IconShieldCheck },
  { href: '/app/oversight#withdrawals', label: 'Withdrawals', icon: IconCoins },
  { href: '/app/oversight#audit', label: 'Audit Trail', icon: IconFileText },
  { href: '/app/oversight#contract', label: 'Smart Contract', icon: IconSettings },
]

export default async function OversightLayout({ children }: { children: ReactNode }) {
  await requireAnyRole(['platform_compliance', 'super_admin'])

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 w-64 border-r border-white/10 bg-black/80 backdrop-blur-xl">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-6">
          <Link href="/app/oversight" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20 ring-1 ring-violet-500/30">
              <IconShieldCheck className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <p className="font-semibold text-white">Oversight</p>
              <p className="text-xs text-zinc-500">Regulator Portal</p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="p-4">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">Navigation</p>
          <div className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            ))}
          </div>

          <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-xs font-medium text-emerald-300">Live Data</span>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              All metrics update in real-time from blockchain and database.
            </p>
          </div>
        </nav>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 p-4">
          <div className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
            <p className="text-xs font-medium text-zinc-400">nTZS Stablecoin</p>
            <p className="mt-1 text-xs text-zinc-600">Base Sepolia Network</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 pl-64">
        {children}
      </main>
    </div>
  )
}
