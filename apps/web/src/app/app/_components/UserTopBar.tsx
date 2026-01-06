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
    <div className="sticky top-0 z-30 border-b border-white/10 bg-black/40 backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          {showBack ? (
            <Link
              href="/app/user"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08] hover:text-white"
            >
              <IconChevronLeft className="h-4 w-4" />
            </Link>
          ) : null}
          <div className="text-sm font-semibold text-white">{title}</div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/account/settings"
            className="hidden rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/80 hover:bg-white/[0.08] md:inline-flex"
          >
            Account
          </Link>
          <UserButton size="icon" />
        </div>
      </div>
    </div>
  )
}
