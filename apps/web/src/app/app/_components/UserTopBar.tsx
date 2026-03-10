'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@neondatabase/neon-js/auth/react/ui'

import { IconChevronLeft } from '@/app/app/_components/icons'

function getTitle(pathname: string) {
  if (pathname === '/app/user') return 'Dashboard'
  if (pathname.startsWith('/app/user/deposits')) return 'Deposit'
  if (pathname.startsWith('/app/user/activity')) return 'Activity'
  if (pathname.startsWith('/app/user/wallet')) return 'Wallet'
  if (pathname.startsWith('/app/user/invite')) return 'Invite & Earn'
  if (pathname.startsWith('/app/user/stake')) return 'Stake to Earn'
  return 'Wallet'
}

export function UserTopBar() {
  const pathname = usePathname()
  const title = getTitle(pathname)
  const showBack = pathname !== '/app/user'

  return (
    <div className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0a0a0f]/90 backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between px-5">
        <div className="flex items-center gap-3">
          {showBack ? (
            <Link
              href="/app/user"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <IconChevronLeft className="h-4 w-4" />
            </Link>
          ) : null}
          <div className="text-sm font-semibold text-white">{title}</div>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/account/settings"
            className="hidden rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white md:inline-flex"
          >
            Account
          </Link>
          <UserButton size="icon" />
        </div>
      </div>
    </div>
  )
}
