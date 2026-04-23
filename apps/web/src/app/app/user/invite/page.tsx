import { requireAnyRole, requireDbUser } from '@/lib/auth/rbac'
import { InviteClient } from './_components/InviteClient'

export default async function InvitePage() {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ntzs.co.tz'
  const code = `NTZS-${dbUser.id.slice(0, 8).toUpperCase()}`
  const inviteUrl = `${baseUrl}/auth/sign-up?ref=${code}`

  return <InviteClient code={code} inviteUrl={inviteUrl} />
}
