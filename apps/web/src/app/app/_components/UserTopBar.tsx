'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@neondatabase/neon-js/auth/react/ui'

import { IconChevronLeft } from '@/app/app/_components/icons'

function getTitle(pathname: string) {
  if (pathname.startsWith('/app/user/deposits')) return 'Deposit'
  if (pathname.startsWith('/app/user/activity'))  return 'Activity'
  if (pathname.startsWith('/app/user/wallet'))     return 'Wallet'
  if (pathname.startsWith('/app/user/invite'))     return 'Invite & Earn'
  if (pathname.startsWith('/app/user/stake'))      return 'Stake to Earn'
  if (pathname.startsWith('/app/user/kyc'))        return 'Verify ID'
  if (pathname.startsWith('/app/user/withdraw'))   return 'Withdraw'
  return null
}

export function UserTopBar() {
  const pathname = usePathname()
  const isHome = pathname === '/app/user'
  const title  = getTitle(pathname)

  /* ── Home: floating avatar only, no bar ── */
  if (isHome) {
    return (
      <div className="pointer-events-none fixed right-4 top-4 z-40 sm:right-6 sm:top-5">
        <div className="pointer-events-auto">
          <UserButton size="icon" />
        </div>
      </div>
    )
  }

  /* ── Sub-pages: slim back bar + title + avatar ── */
  return (
    <div className="sticky top-0 z-30 border-b border-white/[0.05] bg-[#0d0d14]/95 backdrop-blur-xl">
      <div className="flex h-12 items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <Link
            href="/app/user"
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <IconChevronLeft className="h-4 w-4" />
          </Link>
          {title && (
            <span className="text-sm font-medium text-white/70">{title}</span>
          )}
        </div>

        <UserButton size="icon" />
      </div>
    </div>
  )
}
