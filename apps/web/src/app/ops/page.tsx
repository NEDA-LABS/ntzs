import { requireAnyRole } from '@/lib/auth/rbac'

export default async function OpsHome() {
  const dbUser = await requireAnyRole([
    'bank_admin',
    'platform_compliance',
    'super_admin',
  ])

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-black">
        <h1 className="text-2xl font-semibold">Ops</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Protected ops area.
        </p>
      </div>

      <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-black">
        <h2 className="text-lg font-semibold">DB user</h2>
        <pre className="mt-3 overflow-x-auto rounded bg-zinc-50 p-3 text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          {JSON.stringify(dbUser, null, 2)}
        </pre>
      </div>
    </main>
  )
}
