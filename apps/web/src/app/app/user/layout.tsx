import type { ReactNode } from 'react'
import Link from 'next/link'
import { eq } from 'drizzle-orm'

import { requireDbUser, requireRole } from '@/lib/auth/rbac'
import { UserTopBar } from '@/app/app/_components/UserTopBar'
import { getDb } from '@/lib/db'
import { wallets } from '@ntzs/db'

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

export default async function UserLayout({ children }: { children: ReactNode }) {
  await requireRole('end_user')
  const dbUser = await requireDbUser()
  const { db } = getDb()

  const wallet = await db.query.wallets.findFirst({
    where: eq(wallets.userId, dbUser.id),
  })

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 w-64 border-r border-white/10 bg-black/70 backdrop-blur-xl">
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
        <nav className="p-4 pb-28">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">Menu</p>
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

          <p className="mb-3 mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">Rewards</p>
          <div className="space-y-1">
            {rewardItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
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
        <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 p-4">
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

      {/* Main Content */}
      <main className="flex-1 pl-64">
        <UserTopBar />
        {children}
      </main>
    </div>
  )
}
