import Link from 'next/link'
import { neonAuth } from '@neondatabase/neon-js/auth/next'

import { syncNeonAuthUser } from '@/lib/user/syncNeonAuthUser'

export default async function AppHome() {
  const { user } = await neonAuth()
  const dbUser = await syncNeonAuthUser()

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-black">
        <h1 className="text-2xl font-semibold">nTZS App</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          This page verifies Neon Auth + DB user sync.
        </p>
      </div>

      <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-black">
        <h2 className="text-lg font-semibold">Neon Auth user</h2>
        <pre className="mt-3 overflow-x-auto rounded bg-zinc-50 p-3 text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          {JSON.stringify(user, null, 2)}
        </pre>
      </div>

      <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-black">
        <h2 className="text-lg font-semibold">DB user</h2>
        <pre className="mt-3 overflow-x-auto rounded bg-zinc-50 p-3 text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          {JSON.stringify(dbUser, null, 2)}
        </pre>

        <div className="mt-4 flex gap-3">
          <Link className="underline" href="/account/settings">
            Account settings
          </Link>
          <Link className="underline" href="/auth/sign-out">
            Sign out
          </Link>
        </div>
      </div>
    </main>
  )
}
