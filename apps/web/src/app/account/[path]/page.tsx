import { AccountView } from '@neondatabase/neon-js/auth/react/ui'

export const dynamicParams = false

export default async function AccountPage({
  params,
}: {
  params: Promise<{ path: string }>
}) {
  const { path } = await params

  return (
    <main className="container mx-auto flex grow flex-col items-center justify-center gap-3 self-center p-4 md:p-6">
      <AccountView path={path} />
    </main>
  )
}
