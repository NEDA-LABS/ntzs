import { desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { UserRole, requireRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { users } from '@ntzs/db'
import { NtzsAdminPanel } from './NtzsAdminPanel'

async function updateUserRoleAction(formData: FormData) {
  'use server'

  await requireRole('super_admin')

  const userId = String(formData.get('userId') ?? '')
  const role = String(formData.get('role') ?? '') as UserRole

  if (!userId) {
    throw new Error('Missing userId')
  }

  const allowedRoles: UserRole[] = [
    'end_user',
    'bank_admin',
    'platform_compliance',
    'super_admin',
  ]

  if (!allowedRoles.includes(role)) {
    throw new Error('Invalid role')
  }

  const { db } = getDb()

  await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId))

  revalidatePath('/backstage')
}

export default async function BackstagePage() {
  await requireRole('super_admin')

  const ntzsContractAddress =
    process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA ??
    process.env.NTZS_CONTRACT_ADDRESS_BASE ??
    ''
  const ntzsSafeAdmin = process.env.NTZS_SAFE_ADMIN ?? ''
  const chainLabel = '84532'

  const { db } = getDb()

  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      neonAuthUserId: users.neonAuthUserId,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(200)

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-black">
        <h1 className="text-2xl font-semibold">Backstage</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Super admin portal.
        </p>
      </div>

      <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-black">
        <h2 className="text-lg font-semibold">Users</h2>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {allUsers.map((u) => (
                <tr key={u.id} className="border-b">
                  <td className="py-2 pr-4">
                    <div className="font-medium">{u.email}</div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">
                      {u.neonAuthUserId}
                    </div>
                  </td>
                  <td className="py-2 pr-4">{u.role}</td>
                  <td className="py-2 pr-4">
                    {u.createdAt ? new Date(u.createdAt).toLocaleString() : ''}
                  </td>
                  <td className="py-2 pr-4">
                    <form action={updateUserRoleAction} className="flex gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <select
                        name="role"
                        defaultValue={u.role}
                        className="rounded border bg-transparent px-2 py-1"
                      >
                        <option value="end_user">end_user</option>
                        <option value="bank_admin">bank_admin</option>
                        <option value="platform_compliance">
                          platform_compliance
                        </option>
                        <option value="super_admin">super_admin</option>
                      </select>
                      <button
                        type="submit"
                        className="rounded border px-3 py-1"
                      >
                        Update
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {ntzsContractAddress && ntzsSafeAdmin ? (
        <NtzsAdminPanel
          contractAddress={ntzsContractAddress}
          chainLabel={chainLabel}
          safeAdmin={ntzsSafeAdmin}
        />
      ) : (
        <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-black">
          <h2 className="text-lg font-semibold">nTZS Admin</h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Set NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA and NTZS_SAFE_ADMIN to enable
            admin actions.
          </p>
        </div>
      )}
    </main>
  )
}
