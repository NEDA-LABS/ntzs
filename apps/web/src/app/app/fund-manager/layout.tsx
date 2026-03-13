import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentDbUser } from '@/lib/auth/rbac'

const navItems = [
  {
    name: 'Dashboard',
    href: '/app/fund-manager',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    name: 'Positions',
    href: '/app/fund-manager/positions',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    name: 'Transactions',
    href: '/app/fund-manager/transactions',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
]

export default async function FundManagerLayout({ children }: { children: React.ReactNode }) {
  const dbUser = await getCurrentDbUser()

  if (!dbUser) redirect('/auth/sign-in')
  if (dbUser.role !== 'fund_manager' && dbUser.role !== 'super_admin') redirect('/app')

  return (
    <div className="min-h-screen bg-black">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-50 w-64 border-r border-white/10 bg-zinc-950">
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-6">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-purple-600">
            <img src="/ntzs-logo.png" alt="nTZS" className="h-6 w-6 object-contain" />
          </div>
          <div>
            <p className="font-semibold text-white">nTZS</p>
            <p className="text-xs text-zinc-500">Fund Manager</p>
          </div>
        </div>

        {/* Nav */}
        <div className="p-4">
          <p className="mb-3 px-4 text-xs font-semibold uppercase tracking-wider text-zinc-600">
            Portfolio
          </p>
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                {item.icon}
                {item.name}
              </Link>
            ))}
          </nav>
        </div>

        {/* Bottom */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-400 to-purple-500 text-xs font-bold text-white">
              FM
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">Fund Manager</p>
              <p className="text-xs text-zinc-500">Portfolio view</p>
            </div>
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="pl-64">{children}</main>
    </div>
  )
}
