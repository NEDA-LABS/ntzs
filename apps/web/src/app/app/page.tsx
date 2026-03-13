import { redirect } from 'next/navigation'

import { requireDbUser } from '@/lib/auth/rbac'

export default async function AppHome() {
  const dbUser = await requireDbUser()

  if (dbUser.role === 'bank_admin') {
    redirect('/app/bank')
  }

  if (dbUser.role === 'platform_compliance') {
    redirect('/app/compliance')
  }

  if (dbUser.role === 'super_admin') {
    redirect('/app/admin')
  }

  if (dbUser.role === 'fund_manager') {
    redirect('/app/fund-manager')
  }

  redirect('/app/user')
}
