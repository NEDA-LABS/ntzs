import { desc, eq, count } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'

import { UserRole, requireAnyRole, requireRole, getCurrentDbUser } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { users, kycCases, depositRequests, depositApprovals, banks, wallets } from '@ntzs/db'
import { writeAuditLog } from '@/lib/audit'
import { formatDateEAT } from '@/lib/format-date'

// Icon components
function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  )
}

function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  )
}

function BanknotesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
    </svg>
  )
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  )
}

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

  await writeAuditLog('user.role_changed', 'user', userId, { newRole: role })

  revalidatePath('/backstage')
}

async function updateKycStatusAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin', 'platform_compliance'])
  const currentUser = await getCurrentDbUser()
  if (!currentUser) throw new Error('User not found')

  const kycCaseId = String(formData.get('kycCaseId') ?? '')
  const status = String(formData.get('status') ?? '') as 'approved' | 'rejected'
  const reason = String(formData.get('reason') ?? '')

  if (!kycCaseId || !['approved', 'rejected'].includes(status)) {
    throw new Error('Invalid parameters')
  }

  const { db } = getDb()

  await db
    .update(kycCases)
    .set({
      status,
      reviewedByUserId: currentUser.id,
      reviewedAt: new Date(),
      reviewReason: reason || null,
      updatedAt: new Date(),
    })
    .where(eq(kycCases.id, kycCaseId))

  await writeAuditLog(`kyc.${status}`, 'kyc_case', kycCaseId, { reason: reason || null }, currentUser.id)

  revalidatePath('/backstage')
}

async function approveDepositAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin', 'bank_admin'])
  const currentUser = await getCurrentDbUser()
  if (!currentUser) throw new Error('User not found')

  const depositId = String(formData.get('depositId') ?? '')
  const decision = String(formData.get('decision') ?? '') as 'approved' | 'rejected'
  const reason = String(formData.get('reason') ?? '')

  if (!depositId || !['approved', 'rejected'].includes(decision)) {
    throw new Error('Invalid parameters')
  }

  const { db } = getDb()

  // Get the deposit request
  const [deposit] = await db
    .select()
    .from(depositRequests)
    .where(eq(depositRequests.id, depositId))
    .limit(1)

  if (!deposit) {
    throw new Error('Deposit not found')
  }

  // Create platform approval
  await db.insert(depositApprovals).values({
    depositRequestId: depositId,
    approverUserId: currentUser.id,
    approvalType: 'platform',
    decision,
    reason: reason || null,
  })

  // Update deposit status based on decision
  // When approved, set to mint_pending so the worker picks it up
  const newStatus = decision === 'approved' ? 'mint_pending' : 'rejected'
  
  await db
    .update(depositRequests)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(depositRequests.id, depositId))

  await writeAuditLog(`deposit.${decision}`, 'deposit_request', depositId, { decision, reason: reason || null }, currentUser.id)

  revalidatePath('/backstage')
}

// Role badge component
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

// Stat card component
function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendUp,
}: {
  title: string
  value: number | string
  subtitle?: string
  icon: React.ComponentType<{ className?: string }>
  trend?: string
  trendUp?: boolean
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900 to-zinc-950 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-400">{title}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-white">{value}</p>
          {subtitle && <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>}
          {trend && (
            <p className={`mt-2 flex items-center text-xs font-medium ${trendUp ? 'text-emerald-400' : 'text-rose-400'}`}>
              <span className="mr-1">{trendUp ? '↑' : '↓'}</span>
              {trend}
            </p>
          )}
        </div>
        <div className="rounded-xl bg-white/5 p-3">
          <Icon className="h-6 w-6 text-zinc-400" />
        </div>
      </div>
    </div>
  )
}

export default async function BackstagePage() {
  const { db } = getDb()

  // Fetch stats
  const [userCountResult] = await db.select({ count: count() }).from(users)
  const totalUsers = userCountResult?.count ?? 0

  const [pendingKycCountResult] = await db
    .select({ count: count() })
    .from(kycCases)
    .where(eq(kycCases.status, 'pending'))
  const pendingKycCount = pendingKycCountResult?.count ?? 0

  const [pendingDepositCountResult] = await db
    .select({ count: count() })
    .from(depositRequests)
    .where(eq(depositRequests.status, 'bank_approved'))
  const pendingDepositCount = pendingDepositCountResult?.count ?? 0

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
    .limit(100)

  // Fetch pending KYC cases with user info
  const pendingKycCases = await db
    .select({
      id: kycCases.id,
      nationalId: kycCases.nationalId,
      status: kycCases.status,
      provider: kycCases.provider,
      createdAt: kycCases.createdAt,
      userEmail: users.email,
      userId: users.id,
    })
    .from(kycCases)
    .innerJoin(users, eq(kycCases.userId, users.id))
    .where(eq(kycCases.status, 'pending'))
    .orderBy(desc(kycCases.createdAt))
    .limit(50)

  // Fetch pending deposit requests (awaiting platform approval)
  const pendingDeposits = await db
    .select({
      id: depositRequests.id,
      amountTzs: depositRequests.amountTzs,
      status: depositRequests.status,
      chain: depositRequests.chain,
      createdAt: depositRequests.createdAt,
      userEmail: users.email,
      userId: users.id,
      bankName: banks.name,
      walletAddress: wallets.address,
    })
    .from(depositRequests)
    .innerJoin(users, eq(depositRequests.userId, users.id))
    .innerJoin(banks, eq(depositRequests.bankId, banks.id))
    .innerJoin(wallets, eq(depositRequests.walletId, wallets.id))
    .where(eq(depositRequests.status, 'bank_approved'))
    .orderBy(desc(depositRequests.createdAt))
    .limit(50)

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <div className="border-b border-white/10 bg-zinc-950/50">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Dashboard</h1>
              <p className="mt-1 text-sm text-zinc-400">Overview of platform activity</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              System Online
            </span>
          </div>
        </div>
      </div>

      <div className="p-8">
        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Users"
            value={totalUsers}
            subtitle="Registered accounts"
            icon={UsersIcon}
          />
          <StatCard
            title="Pending KYC"
            value={pendingKycCount}
            subtitle="Awaiting review"
            icon={ShieldCheckIcon}
          />
          <StatCard
            title="Pending Mints"
            value={pendingDepositCount}
            subtitle="Awaiting approval"
            icon={BanknotesIcon}
          />
          <StatCard
            title="Active Sessions"
            value="—"
            subtitle="Real-time users"
            icon={ClockIcon}
          />
        </div>

        {/* Main Content Grid */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Users List - Takes 2 columns */}
          <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Recent Users</h2>
                <p className="text-sm text-zinc-500">{totalUsers} total accounts</p>
              </div>
              <Link href="/backstage/users" className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white transition-colors">
                View all
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur">
                  <tr className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                    <th className="px-6 py-3">User</th>
                    <th className="px-6 py-3">Role</th>
                    <th className="px-6 py-3">Joined</th>
                    <th className="px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {allUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-white">{u.email}</div>
                        <div className="mt-0.5 truncate max-w-[200px] text-xs text-zinc-600 font-mono">
                          {u.neonAuthUserId}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <RoleBadge role={u.role} />
                      </td>
                      <td className="px-6 py-4 text-sm text-zinc-400">
                        {formatDateEAT(u.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <form action={updateUserRoleAction} className="flex items-center gap-2">
                          <input type="hidden" name="userId" value={u.id} />
                          <select
                            name="role"
                            defaultValue={u.role}
                            className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-sm text-white focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/10"
                          >
                            <option value="end_user">end_user</option>
                            <option value="bank_admin">bank_admin</option>
                            <option value="platform_compliance">platform_compliance</option>
                            <option value="super_admin">super_admin</option>
                          </select>
                          <button
                            type="submit"
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors"
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

          {/* Quick Actions Sidebar */}
          <div className="space-y-6">
            {/* KYC Verification Card */}
            <div className="rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-amber-500/10 p-2">
                    <ShieldCheckIcon className="h-5 w-5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">KYC Verification</h3>
                    <p className="text-xs text-zinc-500">{pendingKycCount} pending</p>
                  </div>
                </div>
              </div>
              <div className="max-h-[250px] overflow-y-auto">
                {pendingKycCases.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <ShieldCheckIcon className="mx-auto h-8 w-8 text-zinc-700" />
                    <p className="mt-2 text-sm text-zinc-500">No pending KYC cases</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {pendingKycCases.map((kyc) => (
                      <div key={kyc.id} className="px-5 py-4 hover:bg-white/[0.02] transition-colors">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium text-white text-sm">{kyc.userEmail}</p>
                            <p className="mt-0.5 font-mono text-xs text-zinc-500">{kyc.nationalId}</p>
                            <p className="mt-1 text-xs text-zinc-600">
                              {kyc.provider} · {formatDateEAT(kyc.createdAt)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <form action={updateKycStatusAction} className="flex-1">
                            <input type="hidden" name="kycCaseId" value={kyc.id} />
                            <input type="hidden" name="status" value="approved" />
                            <button
                              type="submit"
                              className="w-full rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                            >
                              Approve
                            </button>
                          </form>
                          <form action={updateKycStatusAction} className="flex-1">
                            <input type="hidden" name="kycCaseId" value={kyc.id} />
                            <input type="hidden" name="status" value="rejected" />
                            <button
                              type="submit"
                              className="w-full rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20 transition-colors"
                            >
                              Reject
                            </button>
                          </form>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Minting Approvals Card */}
            <div className="rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-500/10 p-2">
                    <BanknotesIcon className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Minting Approvals</h3>
                    <p className="text-xs text-zinc-500">{pendingDepositCount} pending</p>
                  </div>
                </div>
              </div>
              <div className="max-h-[250px] overflow-y-auto">
                {pendingDeposits.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <BanknotesIcon className="mx-auto h-8 w-8 text-zinc-700" />
                    <p className="mt-2 text-sm text-zinc-500">No pending deposits</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {pendingDeposits.map((dep) => (
                      <div key={dep.id} className="px-5 py-4 hover:bg-white/[0.02] transition-colors">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium text-white text-sm">{dep.userEmail}</p>
                            <p className="mt-0.5 font-mono text-lg font-bold text-emerald-400">
                              {dep.amountTzs.toLocaleString()} <span className="text-xs text-zinc-500">TZS</span>
                            </p>
                            <p className="mt-1 text-xs text-zinc-600">
                              {dep.bankName} · {dep.chain}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <form action={approveDepositAction} className="flex-1">
                            <input type="hidden" name="depositId" value={dep.id} />
                            <input type="hidden" name="decision" value="approved" />
                            <button
                              type="submit"
                              className="w-full rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                            >
                              Approve Mint
                            </button>
                          </form>
                          <form action={approveDepositAction} className="flex-1">
                            <input type="hidden" name="depositId" value={dep.id} />
                            <input type="hidden" name="decision" value="rejected" />
                            <button
                              type="submit"
                              className="w-full rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20 transition-colors"
                            >
                              Reject
                            </button>
                          </form>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/backstage/users"
            className="group rounded-2xl border border-white/10 bg-zinc-900/50 p-5 transition-colors hover:border-white/20 hover:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-blue-500/10 p-2.5">
                <UsersIcon className="h-5 w-5 text-blue-400" />
              </div>
              <ArrowRightIcon className="h-4 w-4 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-white" />
            </div>
            <h3 className="mt-4 font-semibold text-white">User Management</h3>
            <p className="mt-1 text-sm text-zinc-500">Manage roles and permissions</p>
          </Link>

          <Link
            href="/backstage/kyc"
            className="group rounded-2xl border border-white/10 bg-zinc-900/50 p-5 transition-colors hover:border-white/20 hover:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-amber-500/10 p-2.5">
                <ShieldCheckIcon className="h-5 w-5 text-amber-400" />
              </div>
              <ArrowRightIcon className="h-4 w-4 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-white" />
            </div>
            <h3 className="mt-4 font-semibold text-white">KYC Verification</h3>
            <p className="mt-1 text-sm text-zinc-500">Review identity submissions</p>
          </Link>

          <Link
            href="/backstage/minting"
            className="group rounded-2xl border border-white/10 bg-zinc-900/50 p-5 transition-colors hover:border-white/20 hover:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-emerald-500/10 p-2.5">
                <BanknotesIcon className="h-5 w-5 text-emerald-400" />
              </div>
              <ArrowRightIcon className="h-4 w-4 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-white" />
            </div>
            <h3 className="mt-4 font-semibold text-white">Minting Queue</h3>
            <p className="mt-1 text-sm text-zinc-500">Approve deposit requests</p>
          </Link>

          <Link
            href="/backstage/token-admin"
            className="group rounded-2xl border border-white/10 bg-zinc-900/50 p-5 transition-colors hover:border-white/20 hover:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-violet-500/10 p-2.5">
                <svg className="h-5 w-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <ArrowRightIcon className="h-4 w-4 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-white" />
            </div>
            <h3 className="mt-4 font-semibold text-white">Token Admin</h3>
            <p className="mt-1 text-sm text-zinc-500">On-chain contract actions</p>
          </Link>
        </div>
      </div>
    </div>
  )
}
