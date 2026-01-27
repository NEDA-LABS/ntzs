import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'

import { UserRole, requireRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { users, wallets } from '@ntzs/db'

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

  revalidatePath('/backstage/users')
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    super_admin: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    platform_compliance: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    bank_admin: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    end_user: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[role] || styles.end_user}`}>
      {role.replace('_', ' ')}
    </span>
  )
}

export default async function UsersPage() {
  await requireRole('super_admin')
  const { db } = getDb()

  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      phone: users.phone,
      isActive: users.isActive,
      createdAt: users.createdAt,
      neonAuthUserId: users.neonAuthUserId,
      walletAddress: wallets.address,
    })
    .from(users)
    .leftJoin(wallets, eq(wallets.userId, users.id))
    .orderBy(desc(users.createdAt))
    .limit(500)

  const tokenAdminBaseSepolia = '/backstage/token-admin?chain=base_sepolia'

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <div className="border-b border-white/10 bg-zinc-950/50">
        <div className="px-8 py-6">
          <h1 className="text-2xl font-bold text-white">User Management</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Manage user accounts, roles, and permissions
          </p>
        </div>
      </div>

      <div className="p-8">
        <div className="mb-6 flex flex-wrap gap-2">
          <Link
            href={`${tokenAdminBaseSepolia}&action=pause`}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Pause Token
          </Link>
          <Link
            href={`${tokenAdminBaseSepolia}&action=unpause`}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Unpause Token
          </Link>
          <Link
            href={tokenAdminBaseSepolia}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Open Token Admin
          </Link>
        </div>
        {/* Stats */}
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-2xl font-bold text-white">{allUsers.length}</p>
            <p className="text-sm text-zinc-500">Total Users</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-2xl font-bold text-purple-400">
              {allUsers.filter(u => u.role === 'super_admin').length}
            </p>
            <p className="text-sm text-zinc-500">Super Admins</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-2xl font-bold text-amber-400">
              {allUsers.filter(u => u.role === 'bank_admin').length}
            </p>
            <p className="text-sm text-zinc-500">Bank Admins</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-2xl font-bold text-zinc-400">
              {allUsers.filter(u => u.role === 'end_user').length}
            </p>
            <p className="text-sm text-zinc-500">End Users</p>
          </div>
        </div>

        {/* Users Table */}
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-900/80">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Wallet</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Joined</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {allUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-white">{u.email}</div>
                      <div className="mt-0.5 truncate max-w-[280px] text-xs text-zinc-600 font-mono">
                        {u.neonAuthUserId}
                      </div>
                      {u.phone && (
                        <div className="mt-0.5 text-xs text-zinc-500">{u.phone}</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {u.walletAddress ? (
                        <div className="space-y-2">
                          <div className="truncate font-mono text-xs text-zinc-300" title={u.walletAddress}>
                            {u.walletAddress}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`${tokenAdminBaseSepolia}&action=freeze&account=${encodeURIComponent(String(u.walletAddress))}`}
                              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15"
                            >
                              Freeze
                            </Link>
                            <Link
                              href={`${tokenAdminBaseSepolia}&action=unfreeze&account=${encodeURIComponent(String(u.walletAddress))}`}
                              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15"
                            >
                              Unfreeze
                            </Link>
                            <Link
                              href={`${tokenAdminBaseSepolia}&action=blacklist&account=${encodeURIComponent(String(u.walletAddress))}`}
                              className="rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/30"
                            >
                              Blacklist
                            </Link>
                            <Link
                              href={`${tokenAdminBaseSepolia}&action=unblacklist&account=${encodeURIComponent(String(u.walletAddress))}`}
                              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15"
                            >
                              Unblacklist
                            </Link>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${u.isActive ? 'text-emerald-400' : 'text-zinc-500'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${u.isActive ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-400">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-6 py-4">
                      <form action={updateUserRoleAction} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <select
                          name="role"
                          defaultValue={u.role}
                          className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                        >
                          <option value="end_user">End User</option>
                          <option value="bank_admin">Bank Admin</option>
                          <option value="platform_compliance">Compliance</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                        <button
                          type="submit"
                          className="rounded-lg bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-400 hover:bg-violet-500/20 transition-colors"
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
      </div>
    </div>
  )
}
