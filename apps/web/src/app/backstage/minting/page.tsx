import { desc, eq, sql } from 'drizzle-orm'
import { ethers } from 'ethers'
import { revalidatePath } from 'next/cache'

import { requireAnyRole, getCurrentDbUser } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import {
  users,
  depositRequests,
  depositApprovals,
  banks,
  wallets,
  mintTransactions,
  dailyIssuance,
} from '@ntzs/db'
import { SafeMintActions } from './_components/SafeMintActions'

const SAFE_MINT_THRESHOLD_TZS = 9000

function getTodayUTC(): string {
  return new Date().toISOString().slice(0, 10)
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
  const newStatus =
    decision === 'approved'
      ? deposit.paymentProvider === 'zenopay' && deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS
        ? 'mint_requires_safe'
        : 'mint_pending'
      : 'rejected'
  
  await db
    .update(depositRequests)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(depositRequests.id, depositId))

  revalidatePath('/backstage/minting')
}

async function confirmSafeMintAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin', 'bank_admin'])

  const depositId = String(formData.get('depositId') ?? '')
  const txHash = String(formData.get('txHash') ?? '')

  if (!depositId) {
    throw new Error('Invalid parameters')
  }

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error('Invalid transaction hash')
  }

  const { db } = getDb()

  const [dep] = await db
    .select({
      id: depositRequests.id,
      amountTzs: depositRequests.amountTzs,
      status: depositRequests.status,
      chain: depositRequests.chain,
      walletAddress: wallets.address,
    })
    .from(depositRequests)
    .innerJoin(wallets, eq(depositRequests.walletId, wallets.id))
    .where(eq(depositRequests.id, depositId))
    .limit(1)

  if (!dep) {
    throw new Error('Deposit not found')
  }

  if (dep.status !== 'mint_requires_safe') {
    throw new Error('Deposit is not awaiting Safe mint')
  }

  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || ''
  if (!contractAddress || !ethers.isAddress(contractAddress)) {
    throw new Error('Contract address not configured')
  }

  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const receipt = await provider.getTransactionReceipt(txHash)

  if (!receipt) {
    throw new Error('Transaction not found on chain')
  }

  if (receipt.status !== 1) {
    throw new Error('Transaction failed')
  }

  if (!receipt.to || receipt.to.toLowerCase() !== contractAddress.toLowerCase()) {
    throw new Error('Transaction is not for the nTZS contract')
  }

  const decimals = BigInt(18)
  const base = BigInt(10)
  const expectedAmountWei = BigInt(String(dep.amountTzs)) * base ** decimals
  const transferIface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ])

  const zeroAddress = '0x0000000000000000000000000000000000000000'
  const targetWallet = dep.walletAddress.toLowerCase()
  const sawExpectedMint = receipt.logs.some((log) => {
    if (!log.address || log.address.toLowerCase() !== contractAddress.toLowerCase()) return false
    try {
      const parsed = transferIface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      })
      if (!parsed || parsed.name !== 'Transfer') return false
      const from = String(parsed.args.from).toLowerCase()
      const to = String(parsed.args.to).toLowerCase()
      const value = BigInt(parsed.args.value.toString())
      return from === zeroAddress && to === targetWallet && value === expectedAmountWei
    } catch {
      return false
    }
  })

  if (!sawExpectedMint) {
    throw new Error('Transaction does not match expected mint transfer')
  }

  await db
    .update(depositRequests)
    .set({ status: 'minted', updatedAt: new Date() })
    .where(eq(depositRequests.id, depositId))

  await db
    .insert(mintTransactions)
    .values({
      depositRequestId: depositId,
      chain: dep.chain,
      contractAddress,
      txHash,
      status: 'minted',
      error: null,
    })
    .onConflictDoUpdate({
      target: mintTransactions.depositRequestId,
      set: { txHash, status: 'minted', error: null, updatedAt: new Date() },
    })

  const today = getTodayUTC()

  await db
    .insert(dailyIssuance)
    .values({ day: today, capTzs: Number(process.env.DAILY_ISSUANCE_CAP_TZS ?? '100000000'), reservedTzs: 0, issuedTzs: 0 })
    .onConflictDoNothing()

  await db
    .update(dailyIssuance)
    .set({
      issuedTzs: sql`${dailyIssuance.issuedTzs} + ${dep.amountTzs}`,
      updatedAt: new Date(),
    })
    .where(eq(dailyIssuance.day, today))

  revalidatePath('/backstage/minting')
}

async function retryMintAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin', 'bank_admin'])

  const depositId = String(formData.get('depositId') ?? '')

  if (!depositId) {
    throw new Error('Invalid parameters')
  }

  const { db } = getDb()

  // Reset the deposit to mint_pending so the worker picks it up again
  await db
    .update(depositRequests)
    .set({ status: 'mint_pending', updatedAt: new Date() })
    .where(eq(depositRequests.id, depositId))

  // Clear the error in mint_transactions
  await db
    .update(mintTransactions)
    .set({ status: 'pending_retry', error: null, updatedAt: new Date() })
    .where(eq(mintTransactions.depositRequestId, depositId))

  revalidatePath('/backstage/minting')
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    submitted: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
    kyc_pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    kyc_approved: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    kyc_rejected: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    awaiting_fiat: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    fiat_confirmed: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    bank_approved: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
    platform_approved: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    mint_pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    mint_requires_safe: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
    mint_processing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    minted: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    mint_failed: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    rejected: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    cancelled: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[status] || styles.submitted}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export default async function MintingPage() {
  const { db } = getDb()

  // Fetch all deposit requests with related data including mint transaction info
  const allDeposits = await db
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
      txHash: mintTransactions.txHash,
      mintStatus: mintTransactions.status,
      mintError: mintTransactions.error,
      paymentProvider: depositRequests.paymentProvider,
      pspReference: depositRequests.pspReference,
      pspChannel: depositRequests.pspChannel,
    })
    .from(depositRequests)
    .innerJoin(users, eq(depositRequests.userId, users.id))
    .innerJoin(banks, eq(depositRequests.bankId, banks.id))
    .innerJoin(wallets, eq(depositRequests.walletId, wallets.id))
    .leftJoin(mintTransactions, eq(depositRequests.id, mintTransactions.depositRequestId))
    .orderBy(desc(depositRequests.createdAt))
    .limit(200)

  const pendingApproval = allDeposits.filter(d => d.status === 'bank_approved').length
  const totalMinted = allDeposits.filter(d => d.status === 'minted').length
  const totalVolume = allDeposits
    .filter(d => d.status === 'minted')
    .reduce((sum, d) => sum + d.amountTzs, 0)

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <div className="border-b border-white/10 bg-zinc-950/50">
        <div className="px-8 py-6">
          <h1 className="text-2xl font-bold text-white">Minting Queue</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Approve deposit requests and manage nTZS minting
          </p>
        </div>
      </div>

      <div className="p-8">
        {/* Stats */}
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-2xl font-bold text-white">{allDeposits.length}</p>
            <p className="text-sm text-zinc-500">Total Requests</p>
          </div>
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
            <p className="text-2xl font-bold text-violet-400">{pendingApproval}</p>
            <p className="text-sm text-zinc-500">Awaiting Approval</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p className="text-2xl font-bold text-emerald-400">{totalMinted}</p>
            <p className="text-sm text-zinc-500">Successfully Minted</p>
          </div>
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
            <p className="text-2xl font-bold text-blue-400">{totalVolume.toLocaleString()}</p>
            <p className="text-sm text-zinc-500">Total TZS Minted</p>
          </div>
        </div>

        {/* Deposits Table */}
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-900/80">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4">Payment</th>
                  <th className="px-6 py-4">Wallet</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Tx Hash</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {allDeposits.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center">
                      <svg className="mx-auto h-12 w-12 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                      </svg>
                      <p className="mt-4 text-zinc-500">No deposit requests yet</p>
                    </td>
                  </tr>
                ) : (
                  allDeposits.map((dep) => (
                    <tr key={dep.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-white">{dep.userEmail}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-mono text-lg font-bold text-emerald-400">
                          {dep.amountTzs.toLocaleString()}
                        </div>
                        <div className="text-xs text-zinc-500">TZS</div>
                      </td>
                      <td className="px-6 py-4">
                        {dep.paymentProvider === 'zenopay' ? (
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-xs font-medium text-violet-400">
                                ZenoPay
                              </span>
                              {dep.pspChannel && (
                                <span className="text-xs text-zinc-500">{dep.pspChannel}</span>
                              )}
                            </div>
                            {dep.pspReference && (
                              <code className="mt-1 block rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-emerald-400" title={dep.pspReference}>
                                {dep.pspReference}
                              </code>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-zinc-400">{dep.bankName}</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <code className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-300 truncate max-w-[120px] block" title={dep.walletAddress}>
                          {dep.walletAddress.slice(0, 8)}...{dep.walletAddress.slice(-6)}
                        </code>
                        <div className="mt-1 text-xs text-zinc-600">{dep.chain}</div>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={dep.status} />
                        {dep.mintError && (
                          <p className="mt-1 text-xs text-rose-400 max-w-[150px] truncate" title={dep.mintError}>
                            {dep.mintError}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {dep.txHash ? (
                          <a
                            href={`https://sepolia.basescan.org/tx/${dep.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-blue-400 hover:text-blue-300"
                          >
                            {dep.txHash.slice(0, 8)}...{dep.txHash.slice(-6)}
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          </a>
                        ) : (
                          <span className="text-sm text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {dep.status === 'bank_approved' ? (
                          <div className="flex gap-2">
                            <form action={approveDepositAction}>
                              <input type="hidden" name="depositId" value={dep.id} />
                              <input type="hidden" name="decision" value="approved" />
                              <button
                                type="submit"
                                className="rounded-lg bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                              >
                                Approve Mint
                              </button>
                            </form>
                            <form action={approveDepositAction}>
                              <input type="hidden" name="depositId" value={dep.id} />
                              <input type="hidden" name="decision" value="rejected" />
                              <button
                                type="submit"
                                className="rounded-lg bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-400 hover:bg-rose-500/20 transition-colors"
                              >
                                Reject
                              </button>
                            </form>
                          </div>
                        ) : dep.status === 'mint_failed' ? (
                          <form action={retryMintAction}>
                            <input type="hidden" name="depositId" value={dep.id} />
                            <button
                              type="submit"
                              className="rounded-lg bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/20 transition-colors"
                            >
                              Retry Mint
                            </button>
                          </form>
                        ) : dep.status === 'minted' && dep.txHash ? (
                          <span className="inline-flex items-center gap-1 text-sm text-emerald-400">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Minted
                          </span>
                        ) : dep.status === 'mint_pending' || dep.status === 'mint_processing' ? (
                          <span className="inline-flex items-center gap-1 text-sm text-amber-400">
                            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                            Processing
                          </span>
                        ) : dep.status === 'mint_requires_safe' ? (
                          <SafeMintActions
                            depositId={dep.id}
                            amountTzs={dep.amountTzs}
                            walletAddress={dep.walletAddress}
                            contractAddress={process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || ''}
                            chainId="84532"
                            onConfirm={confirmSafeMintAction}
                          />
                        ) : (
                          <span className="text-sm text-zinc-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
