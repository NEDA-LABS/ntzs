import { redirect } from 'next/navigation'
import { getCurrentDbUser } from '@/lib/auth/rbac'

export default async function FundManagerLayout({ children }: { children: React.ReactNode }) {
  const dbUser = await getCurrentDbUser()

  if (!dbUser) redirect('/auth/sign-in')

  if (dbUser.role !== 'fund_manager' && dbUser.role !== 'super_admin') {
    redirect('/app')
  }

  return <>{children}</>
}
