import type { ReactNode } from 'react'

import { requireAnyRole } from '@/lib/auth/rbac'

export default async function OversightLayout({ children }: { children: ReactNode }) {
  await requireAnyRole(['platform_compliance', 'super_admin'])

  return <>{children}</>
}
