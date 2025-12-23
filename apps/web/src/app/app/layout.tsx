import type { ReactNode } from 'react'

import { syncNeonAuthUser } from '@/lib/user/syncNeonAuthUser'

export default async function AppLayout({
  children,
}: {
  children: ReactNode
}) {
  await syncNeonAuthUser()

  return children
}
