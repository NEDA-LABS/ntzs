import { requireAnyRole } from '@/lib/auth/rbac'
import { getCachedRecentDeposits } from '@/lib/user/cachedQueries'
import { CollectClient } from './_components/CollectClient'

export default async function CollectPage() {
  const dbUser = await requireAnyRole(['end_user', 'super_admin'])

  const recentDeposits = await getCachedRecentDeposits(dbUser.id, 20)

  const collections = recentDeposits
    .filter((d) => (d as Record<string, unknown>).source === 'pay_link')
    .slice(0, 10)
    .map((d) => ({
      id: d.id,
      amountTzs: d.amountTzs,
      status: d.status,
      payerName: ((d as Record<string, unknown>).payerName as string) ?? null,
      createdAt: d.createdAt ? String(d.createdAt) : null,
    }))

  return (
    <CollectClient
      payAlias={dbUser.payAlias ?? null}
      collections={collections}
    />
  )
}
