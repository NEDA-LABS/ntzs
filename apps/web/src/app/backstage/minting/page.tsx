import { desc, eq, sql, and } from 'drizzle-orm'
import { ethers } from 'ethers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

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
  auditLogs,
  reconciliationEntries,
} from '@ntzs/db'
import { SafeMintActions } from './_components/SafeMintActions'

const SAFE_MINT_THRESHOLD_TZS = 9000
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
const MINTER_PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY || ''
const NTZS_CONTRACT_ADDRESS = process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || ''
const DAILY_ISSUANCE_CAP_TZS = Number(process.env.DAILY_ISSUANCE_CAP_TZS ?? '100000000')

const NTZS_ABI = [
  'function mint(address to, uint256 amount)',
] as const

function getTodayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

async function processPendingMintsAction() {
  'use server'
  
  await requireAnyRole(['super_admin'])
  
  if (!MINTER_PRIVATE_KEY || !NTZS_CONTRACT_ADDRESS) {
    console.error('[Manual Mint] Minting not configured')
    revalidatePath('/backstage/minting')
    return
  }
  
  const { db } = getDb()
  const today = getTodayUTC()
  
  // Get pending mints
  const pendingDeposits = await db
    .select({
      id: depositRequests.id,
      amountTzs: depositRequests.amountTzs,
      chain: depositRequests.chain,
      walletAddress: wallets.address,
    })
    .from(depositRequests)
    .innerJoin(wallets, eq(depositRequests.walletId, wallets.id))
    .where(eq(depositRequests.status, 'mint_pending'))
    .limit(5)
  
  if (pendingDeposits.length === 0) {
    revalidatePath('/backstage/minting')
    return
  }
  
  const provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC_URL)
  const signer = new ethers.Wallet(MINTER_PRIVATE_KEY, provider)
  const contract = new ethers.Contract(NTZS_CONTRACT_ADDRESS, NTZS_ABI, signer)
  
  for (const deposit of pendingDeposits) {
    try {
      // Mark as processing
      await db
        .update(depositRequests)
        .set({ status: 'mint_processing', updatedAt: new Date() })
        .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'mint_pending')))
      
      // Create mint transaction record
      await db
        .insert(mintTransactions)
        .values({
          depositRequestId: deposit.id,
          chain: deposit.chain,
          contractAddress: NTZS_CONTRACT_ADDRESS,
          status: 'pending',
        })
        .onConflictDoUpdate({
          target: mintTransactions.depositRequestId,
          set: { status: 'pending', error: null, updatedAt: new Date() },
        })
      
      // Calculate amount in wei (18 decimals)
      const amountWei = BigInt(deposit.amountTzs) * BigInt(10 ** 18)
      
      // Execute mint
      const tx = await contract.mint(deposit.walletAddress, amountWei)
      const receipt = await tx.wait()
      
      if (receipt && receipt.status === 1) {
        // Success
        await db
          .update(depositRequests)
          .set({ status: 'minted', updatedAt: new Date() })
          .where(eq(depositRequests.id, deposit.id))
        
        await db
          .update(mintTransactions)
          .set({ txHash: receipt.hash, status: 'minted', updatedAt: new Date() })
          .where(eq(mintTransactions.depositRequestId, deposit.id))
        
        // Update daily issuance
        await db
          .insert(dailyIssuance)
          .values({ day: today, capTzs: DAILY_ISSUANCE_CAP_TZS, reservedTzs: 0, issuedTzs: deposit.amountTzs })
          .onConflictDoUpdate({
            target: dailyIssuance.day,
            set: { issuedTzs: sql`${dailyIssuance.issuedTzs} + ${deposit.amountTzs}`, updatedAt: new Date() },
          })
        
        console.log(`[Manual Mint] Minted ${deposit.amountTzs} TZS to ${deposit.walletAddress}, tx: ${receipt.hash}`)
      } else {
        throw new Error('Transaction failed')
      }
    } catch (err) {
      console.error(`[Manual Mint] Error minting deposit ${deposit.id}:`, err)
      await db
        .update(depositRequests)
        .set({ status: 'mint_failed', updatedAt: new Date() })
        .where(eq(depositRequests.id, deposit.id))
      
      await db
        .update(mintTransactions)
        .set({ status: 'failed', error: err instanceof Error ? err.message : 'Unknown error', updatedAt: new Date() })
        .where(eq(mintTransactions.depositRequestId, deposit.id))
    }
  }
  
  revalidatePath('/backstage/minting')
}

async function verifyAndAdvanceSubmittedAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin'])

  const depositId = String(formData.get('depositId') ?? '')
  const manualTransId = String(formData.get('manualTransId') ?? '').trim()

  if (!depositId) {
    throw new Error('Invalid deposit ID')
  }

  const { db } = getDb()

  const [deposit] = await db
    .select()
    .from(depositRequests)
    .where(eq(depositRequests.id, depositId))
    .limit(1)

  if (!deposit || deposit.status !== 'submitted') {
    throw new Error('Deposit not found or not in submitted status')
  }

  let transid = manualTransId
  let channel = 'manual_verify'

  // Try ZenoPay API first, fall back to manual if provided
  const ZENOPAY_API_KEY = process.env.ZENOPAY_API_KEY
  if (ZENOPAY_API_KEY && !manualTransId) {
    try {
      const response = await fetch(
        `https://api.zeno.africa/order-status?order_id=${encodeURIComponent(depositId)}`,
        { headers: { 'x-api-key': ZENOPAY_API_KEY } }
      )

      if (response.ok) {
        const text = await response.text()
        if (text && text.trim() !== '') {
          const data = JSON.parse(text)
          if (data.result === 'SUCCESS' && data.data?.[0]?.payment_status === 'COMPLETED') {
            transid = data.data[0].transid
            channel = data.data[0].channel
          }
        }
      }
    } catch (err) {
      console.warn(`[Admin] ZenoPay API failed for ${depositId}, checking manual entry`)
    }
  }

  // Require either API confirmation or manual transaction ID
  if (!transid) {
    throw new Error('Could not verify with ZenoPay API. Enter the ZenoPay Transaction ID from your dashboard to proceed.')
  }

  // Route to Safe approval if amount >= threshold
  const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS 
    ? 'mint_requires_safe' 
    : 'mint_pending'

  await db
    .update(depositRequests)
    .set({
      status: newStatus,
      pspReference: transid,
      pspChannel: channel,
      fiatConfirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(depositRequests.id, depositId))

  console.log(`[Admin] Advanced deposit ${depositId} to ${newStatus}`, { transid, channel })
  revalidatePath('/backstage/minting')
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

async function confirmSafeMintAction(formData: FormData): Promise<{ success: boolean; error?: string }> {
  'use server'

  try {
    await requireAnyRole(['super_admin', 'bank_admin'])

    const depositId = String(formData.get('depositId') ?? '')
    const txHash = String(formData.get('txHash') ?? '')

    if (!depositId) {
      return { success: false, error: 'Invalid parameters' }
    }

    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return { success: false, error: 'Invalid transaction hash' }
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
    return { success: false, error: 'Deposit not found' }
  }

  if (dep.status !== 'mint_requires_safe') {
    return { success: false, error: 'Deposit is not awaiting Safe mint' }
  }

  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || ''
  if (!contractAddress || !ethers.isAddress(contractAddress)) {
    return { success: false, error: 'Contract address not configured' }
  }

  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const receipt = await provider.getTransactionReceipt(txHash)

  if (!receipt) {
    return { success: false, error: 'Transaction not found on chain' }
  }

  if (receipt.status !== 1) {
    return { success: false, error: 'Transaction failed on chain' }
  }

  // Note: We don't check receipt.to because Safe multisig transactions
  // have receipt.to = Safe address, not the target contract.
  // Instead, we validate via the Transfer event logs below.

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
    return { success: false, error: 'Transaction does not match expected mint transfer' }
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
  return { success: true }
  } catch (err) {
    console.error('[confirmSafeMintAction] Error:', err)
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred' }
  }
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

async function addReconciliationEntryAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin'])
  const currentUser = await getCurrentDbUser()
  if (!currentUser) throw new Error('User not found')

  const txHash = String(formData.get('txHash') ?? '').trim()
  const toAddress = String(formData.get('toAddress') ?? '').trim()
  const amountTzs = Number(formData.get('amountTzs') ?? 0)
  const entryType = String(formData.get('entryType') ?? 'untracked_mint') as 'untracked_mint' | 'test_mint' | 'manual_correction' | 'double_mint' | 'other'
  const reason = String(formData.get('reason') ?? '').trim()
  const notes = String(formData.get('notes') ?? '').trim() || null

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error('Invalid transaction hash')
  }
  if (!toAddress || !ethers.isAddress(toAddress)) {
    throw new Error('Invalid wallet address')
  }
  if (!amountTzs || amountTzs <= 0) {
    throw new Error('Invalid amount')
  }
  if (!reason) {
    throw new Error('Reason is required')
  }

  const { db } = getDb()

  await db.insert(reconciliationEntries).values({
    chain: 'base',
    txHash,
    toAddress,
    amountTzs,
    entryType,
    reason,
    notes,
    createdByUserId: currentUser.id,
  })

  revalidatePath('/backstage/minting')
}

async function getOnChainSupply(): Promise<number | null> {
  try {
    const provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC_URL)
    const token = new ethers.Contract(
      NTZS_CONTRACT_ADDRESS,
      ['function totalSupply() view returns (uint256)', 'function decimals() view returns (uint8)'],
      provider
    )
    const [totalSupply, decimals] = await Promise.all([
      token.totalSupply(),
      token.decimals(),
    ])
    return Number(ethers.formatUnits(totalSupply, decimals))
  } catch (err) {
    console.error('[Minting] Failed to fetch on-chain supply:', err)
    return null
  }
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
  const [allDeposits, allReconciliationEntries, onChainSupply] = await Promise.all([
    db
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
      .limit(200),
    db
      .select()
      .from(reconciliationEntries)
      .orderBy(desc(reconciliationEntries.createdAt)),
    getOnChainSupply(),
  ])

  const pendingApproval = allDeposits.filter(d => d.status === 'bank_approved').length
  const pendingMints = allDeposits.filter(d => d.status === 'mint_pending').length
  const totalMinted = allDeposits.filter(d => d.status === 'minted').length
  const totalVolume = allDeposits
    .filter(d => d.status === 'minted')
    .reduce((sum, d) => sum + d.amountTzs, 0)
  
  // Reconciliation totals
  const reconciliationTotal = allReconciliationEntries.reduce((sum, e) => sum + e.amountTzs, 0)
  const dbTrackedTotal = totalVolume + reconciliationTotal
  const discrepancy = onChainSupply !== null ? onChainSupply - dbTrackedTotal : null

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <div className="border-b border-white/10 bg-zinc-950/50">
        <div className="px-8 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Minting Queue</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Approve deposit requests and manage nTZS minting
            </p>
          </div>
          {pendingMints > 0 && (
            <form action={processPendingMintsAction}>
              <button
                type="submit"
                className="rounded-lg bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/30 transition-colors flex items-center gap-2"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Process {pendingMints} Pending Mint{pendingMints !== 1 ? 's' : ''}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="p-8">
        {/* Supply Reconciliation */}
        <div className="mb-6 rounded-2xl border border-white/10 bg-zinc-900/50 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Supply Reconciliation</h2>
          <div className="grid gap-4 sm:grid-cols-5">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <p className="text-2xl font-bold text-cyan-400">{onChainSupply !== null ? onChainSupply.toLocaleString() : '—'}</p>
              <p className="text-sm text-zinc-500">On-Chain Supply</p>
              <p className="text-xs text-zinc-600 mt-1">Source of truth</p>
            </div>
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
              <p className="text-2xl font-bold text-blue-400">{totalVolume.toLocaleString()}</p>
              <p className="text-sm text-zinc-500">DB Minted</p>
              <p className="text-xs text-zinc-600 mt-1">From deposits</p>
            </div>
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
              <p className="text-2xl font-bold text-violet-400">{reconciliationTotal.toLocaleString()}</p>
              <p className="text-sm text-zinc-500">Reconciled</p>
              <p className="text-xs text-zinc-600 mt-1">{allReconciliationEntries.length} entries</p>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p className="text-2xl font-bold text-emerald-400">{dbTrackedTotal.toLocaleString()}</p>
              <p className="text-sm text-zinc-500">Total Tracked</p>
              <p className="text-xs text-zinc-600 mt-1">DB + Reconciled</p>
            </div>
            <div className={`rounded-xl border p-4 ${discrepancy === 0 ? 'border-emerald-500/20 bg-emerald-500/5' : discrepancy !== null ? 'border-amber-500/20 bg-amber-500/5' : 'border-zinc-500/20 bg-zinc-500/5'}`}>
              <p className={`text-2xl font-bold ${discrepancy === 0 ? 'text-emerald-400' : discrepancy !== null ? 'text-amber-400' : 'text-zinc-400'}`}>
                {discrepancy !== null ? (discrepancy === 0 ? '✓ Balanced' : `${discrepancy > 0 ? '+' : ''}${discrepancy.toLocaleString()}`) : '—'}
              </p>
              <p className="text-sm text-zinc-500">Discrepancy</p>
              <p className="text-xs text-zinc-600 mt-1">{discrepancy === 0 ? 'All accounted' : discrepancy !== null ? 'Needs attention' : 'Loading...'}</p>
            </div>
          </div>
        </div>

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
                        ) : dep.status === 'submitted' ? (
                          <form action={verifyAndAdvanceSubmittedAction} className="flex flex-col gap-1.5">
                            <input type="hidden" name="depositId" value={dep.id} />
                            <input
                              type="text"
                              name="manualTransId"
                              placeholder="ZenoPay Trans ID"
                              className="rounded bg-zinc-800 px-2 py-1 text-xs text-white placeholder:text-zinc-600 border border-zinc-700 focus:border-emerald-500/50 outline-none w-32"
                            />
                            <button
                              type="submit"
                              className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                            >
                              Verify & Advance
                            </button>
                          </form>
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

        {/* Reconciliation Section */}
        {(discrepancy !== null && discrepancy !== 0) || allReconciliationEntries.length > 0 ? (
          <div className="mt-8 space-y-6">
            {/* Add Reconciliation Entry Form */}
            {discrepancy !== null && discrepancy > 0 && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
                <h3 className="text-lg font-semibold text-amber-400 mb-4">Log Untracked Mint</h3>
                <p className="text-sm text-zinc-400 mb-4">
                  There are {discrepancy.toLocaleString()} nTZS on-chain not tracked in the database. 
                  Add a reconciliation entry to account for this discrepancy.
                </p>
                <form action={addReconciliationEntryAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Transaction Hash *</label>
                    <input
                      type="text"
                      name="txHash"
                      placeholder="0x..."
                      required
                      className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:border-amber-500/50 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">To Address *</label>
                    <input
                      type="text"
                      name="toAddress"
                      placeholder="0x..."
                      required
                      className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:border-amber-500/50 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Amount (TZS) *</label>
                    <input
                      type="number"
                      name="amountTzs"
                      placeholder={discrepancy.toString()}
                      defaultValue={discrepancy}
                      required
                      className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:border-amber-500/50 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Entry Type *</label>
                    <select
                      name="entryType"
                      required
                      className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white border border-zinc-700 focus:border-amber-500/50 outline-none"
                    >
                      <option value="double_mint">Double Mint</option>
                      <option value="test_mint">Test Mint</option>
                      <option value="untracked_mint">Untracked Mint</option>
                      <option value="manual_correction">Manual Correction</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Reason *</label>
                    <input
                      type="text"
                      name="reason"
                      placeholder="e.g., Safe transaction executed twice"
                      required
                      className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:border-amber-500/50 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Notes (optional)</label>
                    <input
                      type="text"
                      name="notes"
                      placeholder="Additional details..."
                      className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:border-amber-500/50 outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <button
                      type="submit"
                      className="rounded-lg bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/30 transition-colors"
                    >
                      Add Reconciliation Entry
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Reconciliation Entries Table */}
            {allReconciliationEntries.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-zinc-900/50 overflow-hidden">
                <div className="px-6 py-4 border-b border-white/10">
                  <h3 className="text-lg font-semibold text-white">Reconciliation Entries</h3>
                  <p className="text-sm text-zinc-400">On-chain mints not linked to deposit requests</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-zinc-900/80">
                      <tr className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                        <th className="px-6 py-4">Type</th>
                        <th className="px-6 py-4">Amount</th>
                        <th className="px-6 py-4">To Address</th>
                        <th className="px-6 py-4">Reason</th>
                        <th className="px-6 py-4">Tx Hash</th>
                        <th className="px-6 py-4">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {allReconciliationEntries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-6 py-4">
                            <span className="rounded bg-violet-500/20 px-2 py-1 text-xs font-medium text-violet-400">
                              {entry.entryType.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="font-mono text-lg font-bold text-amber-400">
                              {entry.amountTzs.toLocaleString()}
                            </span>
                            <span className="text-xs text-zinc-500 ml-1">TZS</span>
                          </td>
                          <td className="px-6 py-4">
                            <code className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-300">
                              {entry.toAddress.slice(0, 6)}...{entry.toAddress.slice(-4)}
                            </code>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-white">{entry.reason}</p>
                            {entry.notes && <p className="text-xs text-zinc-500 mt-1">{entry.notes}</p>}
                          </td>
                          <td className="px-6 py-4">
                            <a
                              href={`https://sepolia.basescan.org/tx/${entry.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-cyan-400 hover:underline"
                            >
                              {entry.txHash.slice(0, 10)}...
                            </a>
                          </td>
                          <td className="px-6 py-4 text-sm text-zinc-400">
                            {new Date(entry.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
