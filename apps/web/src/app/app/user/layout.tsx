import type { ReactNode } from 'react'
import { eq } from 'drizzle-orm'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { UserTopBar } from '@/app/app/_components/UserTopBar'
import { getDb } from '@/lib/db'
import { wallets } from '@ntzs/db'
import { provisionPlatformWallet } from '@/lib/waas/platform-wallets'

import { MobileSidebar } from './_components/MobileSidebar'

export default async function UserLayout({ children }: { children: ReactNode }) {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()
  const { db } = getDb()

  let wallet = await db.query.wallets.findFirst({
    where: eq(wallets.userId, dbUser.id),
  })

  // Auto-provision an HD wallet for new direct users who have none yet
  if (!wallet) {
    const address = await provisionPlatformWallet(dbUser.id)
    if (address) {
      wallet = await db.query.wallets.findFirst({
        where: eq(wallets.userId, dbUser.id),
      })
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Collapsible Sidebar */}
      <MobileSidebar wallet={wallet ?? null} />

      {/* Main Content - responsive padding */}
      <main className="flex-1 min-w-0 pl-0 lg:pl-64">
        <UserTopBar />
        <div className="pt-14 pb-20 lg:pt-0 lg:pb-0">
          {children}
        </div>
      </main>
    </div>
  )
}
