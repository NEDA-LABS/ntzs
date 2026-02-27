import { desc, eq, and } from 'drizzle-orm'
import { ethers } from 'ethers'
import { revalidatePath } from 'next/cache'

import { requireRole, requireDbUser } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { burnRequests, users, wallets } from '@ntzs/db'

const SAFE_BURN_THRESHOLD_TZS = 100000
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
const MINTER_PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY || ''
const NTZS_CONTRACT_ADDRESS = process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || ''

const NTZS_ABI = ['function burn(address from, uint256 amount)', 'function paused() view returns (bool)'] as const

async function createBurnRequestAction(formData: FormData) {
  'use server'

  await requireRole('super_admin')
  const dbUser = await requireDbUser()

  const userId = String(formData.get('userId') ?? '')
  const amountTzs = Number(formData.get('amountTzs') ?? 0)
  const reason = String(formData.get('reason') ?? '').trim()

  if (!userId) throw new Error('Missing userId')
  if (!amountTzs || amountTzs <= 0) throw new Error('Invalid amount')
  if (!reason) throw new Error('Reason is required')

  const { db } = getDb()

  const wallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, userId) })
  if (!wallet) throw new Error('User has no wallet')

  if (!NTZS_CONTRACT_ADDRESS || !ethers.isAddress(NTZS_CONTRACT_ADDRESS)) {
    throw new Error('Contract address not configured')
  }

  const status = amountTzs >= SAFE_BURN_THRESHOLD_TZS ? 'requires_second_approval' : 'requested'

  await db.insert(burnRequests).values({
    userId,
    walletId: wallet.id,
    chain: wallet.chain,
    contractAddress: NTZS_CONTRACT_ADDRESS,
    amountTzs,
    reason,
    status,
    requestedByUserId: dbUser.id,
  })

  revalidatePath('/backstage/burns')
}

async function approveBurnRequestAction(formData: FormData) {
  'use server'

  await requireRole('super_admin')
  const dbUser = await requireDbUser()

  const burnRequestId = String(formData.get('burnRequestId') ?? '')
  if (!burnRequestId) throw new Error('Missing burnRequestId')

  const { db } = getDb()

  const [req] = await db
    .select({
      id: burnRequests.id,
      status: burnRequests.status,
      amountTzs: burnRequests.amountTzs,
    })
    .from(burnRequests)
    .where(eq(burnRequests.id, burnRequestId))
    .limit(1)

  if (!req) throw new Error('Burn request not found')

  if (req.status !== 'requested' && req.status !== 'requires_second_approval') {
    throw new Error('Burn request is not in an approvable state')
  }

  const nextStatus = Number(req.amountTzs) >= SAFE_BURN_THRESHOLD_TZS ? 'requires_second_approval' : 'approved'

  await db
    .update(burnRequests)
    .set({
      status: nextStatus,
      approvedByUserId: dbUser.id,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(burnRequests.id, burnRequestId))

  revalidatePath('/backstage/burns')
}

async function secondApproveBurnRequestAction(formData: FormData) {
  'use server'

  await requireRole('super_admin')
  const dbUser = await requireDbUser()

  const burnRequestId = String(formData.get('burnRequestId') ?? '')
  if (!burnRequestId) throw new Error('Missing burnRequestId')

  const { db } = getDb()

  const [req] = await db
    .select({
      id: burnRequests.id,
      status: burnRequests.status,
    })
    .from(burnRequests)
    .where(eq(burnRequests.id, burnRequestId))
    .limit(1)

  if (!req) throw new Error('Burn request not found')

  if (req.status !== 'requires_second_approval') {
    throw new Error('Burn request is not awaiting second approval')
  }

  await db
    .update(burnRequests)
    .set({
      status: 'approved',
      secondApprovedByUserId: dbUser.id,
      secondApprovedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(burnRequests.id, burnRequestId))

  revalidatePath('/backstage/burns')
}

async function executeBurnAction(formData: FormData) {
  'use server'

  await requireRole('super_admin')

  if (!MINTER_PRIVATE_KEY) {
    throw new Error('Burn executor not configured')
  }
  if (!NTZS_CONTRACT_ADDRESS || !ethers.isAddress(NTZS_CONTRACT_ADDRESS)) {
    throw new Error('Contract address not configured')
  }

  const burnRequestId = String(formData.get('burnRequestId') ?? '')
  if (!burnRequestId) throw new Error('Missing burnRequestId')

  const { db } = getDb()

  const [req] = await db
    .select({
      id: burnRequests.id,
      status: burnRequests.status,
      amountTzs: burnRequests.amountTzs,
      walletAddress: wallets.address,
      chain: burnRequests.chain,
      contractAddress: burnRequests.contractAddress,
    })
    .from(burnRequests)
    .innerJoin(wallets, eq(burnRequests.walletId, wallets.id))
    .where(eq(burnRequests.id, burnRequestId))
    .limit(1)

  if (!req) throw new Error('Burn request not found')
  if (req.status !== 'approved') throw new Error('Burn request is not approved')

  const provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC_URL)
  const signer = new ethers.Wallet(MINTER_PRIVATE_KEY, provider)
  const token = new ethers.Contract(req.contractAddress, NTZS_ABI, signer)

  const paused: boolean = await token.paused()
  if (paused) {
    throw new Error('Token is paused; burns are blocked by policy')
  }

  const amountWei = BigInt(String(req.amountTzs)) * BigInt(10) ** BigInt(18)

  await db
    .update(burnRequests)
    .set({ status: 'burn_submitted', updatedAt: new Date(), error: null })
    .where(and(eq(burnRequests.id, burnRequestId), eq(burnRequests.status, 'approved')))

  try {
    const tx = await token.burn(req.walletAddress, amountWei)

    await db
      .update(burnRequests)
      .set({ txHash: tx.hash, status: 'burn_submitted', updatedAt: new Date(), error: null })
      .where(eq(burnRequests.id, burnRequestId))

    await tx.wait(1)

    await db
      .update(burnRequests)
      .set({ status: 'burned', updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db
      .update(burnRequests)
      .set({ status: 'failed', error: errorMessage, updatedAt: new Date() })
      .where(eq(burnRequests.id, burnRequestId))
    throw err
  }

  revalidatePath('/backstage/burns')
}

export default async function BurnsPage() {
  await requireRole('super_admin')

  const { db } = getDb()

  const allUsers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(500)

  const requests = await db
    .select({
      id: burnRequests.id,
      userId: burnRequests.userId,
      amountTzs: burnRequests.amountTzs,
      reason: burnRequests.reason,
      status: burnRequests.status,
      txHash: burnRequests.txHash,
      error: burnRequests.error,
      createdAt: burnRequests.createdAt,
      updatedAt: burnRequests.updatedAt,
      userEmail: users.email,
      walletAddress: wallets.address,
    })
    .from(burnRequests)
    .innerJoin(users, eq(burnRequests.userId, users.id))
    .innerJoin(wallets, eq(burnRequests.walletId, wallets.id))
    .orderBy(desc(burnRequests.createdAt))
    .limit(200)

  return (
    <div className="min-h-screen">
      <div className="border-b border-white/10 bg-zinc-950/50">
        <div className="px-8 py-6">
          <h1 className="text-2xl font-bold text-white">Burns</h1>
          <p className="mt-1 text-sm text-zinc-400">Create and execute user-tied burn requests (withdrawals)</p>
        </div>
      </div>

      <div className="p-8 space-y-8">
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-6">
          <h2 className="text-lg font-semibold text-white">Create burn request</h2>
          <form action={createBurnRequestAction} className="mt-4 grid gap-4 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-zinc-300">User</label>
              <select name="userId" className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-white">
                <option value="">Select user…</option>
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-zinc-300">Amount (TZS)</label>
              <input
                name="amountTzs"
                type="number"
                min={1}
                step={1}
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-white"
                placeholder="1000"
              />
              <p className="mt-1 text-xs text-zinc-500">Second approval required at ≥ {SAFE_BURN_THRESHOLD_TZS.toLocaleString()}.</p>
            </div>
            <div>
              <label className="text-sm font-medium text-zinc-300">Reason</label>
              <input
                name="reason"
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-white"
                placeholder="Withdrawal request"
              />
            </div>
            <div className="md:col-span-4">
              <button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black">Create</button>
            </div>
          </form>
        </div>

        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 overflow-hidden">
          <div className="border-b border-white/10 px-6 py-4">
            <h2 className="font-semibold text-white">Burn requests</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-900/80">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Wallet</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Tx</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-white/10">
                    <td className="px-6 py-4">
                      <div className="text-sm text-white">{r.userEmail}</div>
                      <div className="text-xs text-zinc-500">{new Date(r.createdAt).toLocaleString()}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="truncate font-mono text-xs text-zinc-300" title={r.walletAddress}>
                        {r.walletAddress}
                      </div>
                      <div className="text-xs text-zinc-500 truncate" title={r.reason}>{r.reason}</div>
                      {r.error ? <div className="mt-1 text-xs text-rose-400">{r.error}</div> : null}
                    </td>
                    <td className="px-6 py-4 font-mono text-sm text-white">{Number(r.amountTzs).toLocaleString()} TZS</td>
                    <td className="px-6 py-4">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-zinc-300">
                        {String(r.status).replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {r.txHash ? (
                        <a
                          className="font-mono text-xs text-blue-400 hover:text-blue-300"
                          href={`https://sepolia.basescan.org/tx/${r.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.txHash.slice(0, 10)}…
                        </a>
                      ) : (
                        <span className="text-xs text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        {(r.status === 'requested' || r.status === 'requires_second_approval') && (
                          <form action={approveBurnRequestAction}>
                            <input type="hidden" name="burnRequestId" value={r.id} />
                            <button className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15">Approve</button>
                          </form>
                        )}
                        {r.status === 'requires_second_approval' && (
                          <form action={secondApproveBurnRequestAction}>
                            <input type="hidden" name="burnRequestId" value={r.id} />
                            <button className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15">2nd Approve</button>
                          </form>
                        )}
                        {r.status === 'approved' && (
                          <form action={executeBurnAction}>
                            <input type="hidden" name="burnRequestId" value={r.id} />
                            <button className="rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/30">Execute Burn</button>
                          </form>
                        )}
                      </div>
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
