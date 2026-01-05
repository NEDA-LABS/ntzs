import { desc, eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { UserRole, requireRole, getCurrentDbUser } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { users, kycCases, depositRequests, depositApprovals, banks, wallets } from '@ntzs/db'
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

async function updateKycStatusAction(formData: FormData) {
  'use server'

  await requireRole('super_admin')
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

  revalidatePath('/backstage')
}

async function approveDepositAction(formData: FormData) {
  'use server'

  await requireRole('super_admin')
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
  const newStatus = decision === 'approved' ? 'platform_approved' : 'rejected'
  
  await db
    .update(depositRequests)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(depositRequests.id, depositId))

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

      {/* KYC Management Section */}
      <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-black">
        <h2 className="text-lg font-semibold">KYC Verification</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Review and approve/reject user KYC submissions.
        </p>

        {pendingKycCases.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No pending KYC cases.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">National ID</th>
                  <th className="py-2 pr-4">Provider</th>
                  <th className="py-2 pr-4">Submitted</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingKycCases.map((kyc) => (
                  <tr key={kyc.id} className="border-b">
                    <td className="py-2 pr-4">
                      <div className="font-medium">{kyc.userEmail}</div>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{kyc.nationalId}</td>
                    <td className="py-2 pr-4">{kyc.provider}</td>
                    <td className="py-2 pr-4">
                      {kyc.createdAt ? new Date(kyc.createdAt).toLocaleDateString() : ''}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex gap-2">
                        <form action={updateKycStatusAction}>
                          <input type="hidden" name="kycCaseId" value={kyc.id} />
                          <input type="hidden" name="status" value="approved" />
                          <button
                            type="submit"
                            className="rounded bg-green-600 px-3 py-1 text-white hover:bg-green-700"
                          >
                            Approve
                          </button>
                        </form>
                        <form action={updateKycStatusAction}>
                          <input type="hidden" name="kycCaseId" value={kyc.id} />
                          <input type="hidden" name="status" value="rejected" />
                          <button
                            type="submit"
                            className="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700"
                          >
                            Reject
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Deposit/Minting Approvals Section */}
      <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-black">
        <h2 className="text-lg font-semibold">Minting Approvals</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Review deposits awaiting platform approval before minting nTZS.
        </p>

        {pendingDeposits.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No deposits awaiting approval.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">Amount (TZS)</th>
                  <th className="py-2 pr-4">Bank</th>
                  <th className="py-2 pr-4">Wallet</th>
                  <th className="py-2 pr-4">Chain</th>
                  <th className="py-2 pr-4">Submitted</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingDeposits.map((dep) => (
                  <tr key={dep.id} className="border-b">
                    <td className="py-2 pr-4">
                      <div className="font-medium">{dep.userEmail}</div>
                    </td>
                    <td className="py-2 pr-4 font-mono">
                      {dep.amountTzs.toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">{dep.bankName}</td>
                    <td className="py-2 pr-4">
                      <div className="max-w-[120px] truncate font-mono text-xs" title={dep.walletAddress}>
                        {dep.walletAddress}
                      </div>
                    </td>
                    <td className="py-2 pr-4">{dep.chain}</td>
                    <td className="py-2 pr-4">
                      {dep.createdAt ? new Date(dep.createdAt).toLocaleDateString() : ''}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex gap-2">
                        <form action={approveDepositAction}>
                          <input type="hidden" name="depositId" value={dep.id} />
                          <input type="hidden" name="decision" value="approved" />
                          <button
                            type="submit"
                            className="rounded bg-green-600 px-3 py-1 text-white hover:bg-green-700"
                          >
                            Approve Mint
                          </button>
                        </form>
                        <form action={approveDepositAction}>
                          <input type="hidden" name="depositId" value={dep.id} />
                          <input type="hidden" name="decision" value="rejected" />
                          <button
                            type="submit"
                            className="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700"
                          >
                            Reject
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
