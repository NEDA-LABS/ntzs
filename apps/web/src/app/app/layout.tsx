import type { ReactNode } from 'react'

import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { UserButton } from '@neondatabase/neon-js/auth/react/ui'

import { CdpProvider } from '@/app/app/_components/CdpProvider'
import type { UserRole } from '@/lib/auth/rbac'
import { syncNeonAuthUser } from '@/lib/user/syncNeonAuthUser'

export default async function AppLayout({
  children,
}: {
  children: ReactNode
}) {
  const dbUser = await syncNeonAuthUser()
  if (!dbUser) {
    redirect('/auth/sign-in')
  }

  const role = dbUser.role as UserRole

  if (role === 'end_user') {
    return (
      <CdpProvider>
        <div className="min-h-screen bg-black text-white">
          <div className="pointer-events-none fixed inset-0 opacity-70">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(121,40,202,0.22),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(0,112,243,0.22),transparent_45%),radial-gradient(circle_at_45%_90%,rgba(16,185,129,0.14),transparent_45%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:56px_56px]" />
          </div>

          <div className="relative z-10">{children}</div>
        </div>
      </CdpProvider>
    )
  }

  const navItems: { href: string; label: string }[] = (() => {
    if (role === 'bank_admin') {
      return [{ href: '/app/bank', label: 'Bank' }]
    }

    if (role === 'platform_compliance') {
      return [
        { href: '/app/compliance', label: 'Compliance' },
        { href: '/app/oversight', label: 'Oversight' },
      ]
    }

    if (role === 'bot_regulator') {
      return [
        { href: '/app/compliance', label: 'Compliance Portal' },
      ]
    }

    return [
      { href: '/app/admin', label: 'Admin' },
      { href: '/app/oversight', label: 'Oversight' },
      { href: '/backstage', label: 'Backstage' },
    ]
  })()

  return (
    <CdpProvider>
      <div className="min-h-screen bg-black text-white">
        <div className="pointer-events-none fixed inset-0 opacity-70">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(121,40,202,0.22),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(0,112,243,0.22),transparent_45%),radial-gradient(circle_at_45%_90%,rgba(16,185,129,0.14),transparent_45%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:56px_56px]" />
        </div>

        <header className="relative z-10 border-b border-white/10 bg-black/30 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-3">
              <Link href="/app" className="flex items-center gap-3">
                <div className="overflow-hidden rounded-full">
                  <Image src="/ntzs-logo.png" alt="nTZS" width={28} height={28} />
                </div>
                <div className="text-sm font-semibold tracking-wide">nTZS</div>
              </Link>

              <div className="hidden items-center gap-2 md:flex">
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                  {role.replace('_', ' ')}
                </div>
              </div>
            </div>

            <nav className="hidden items-center gap-6 text-sm text-white/70 md:flex">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-white">
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              <Link
                href="/account/settings"
                className="hidden rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 backdrop-blur-lg hover:bg-white/10 md:inline-flex"
              >
                Account
              </Link>
              <UserButton size="icon" />
            </div>
          </div>
        </header>

        <div className="relative z-10 mx-auto w-full max-w-6xl px-6 py-8">{children}</div>
      </div>
    </CdpProvider>
  )
}
