import { desc, eq, sql, and, ne, inArray, lt } from 'drizzle-orm'
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
  orphanPayments,
} from '@ntzs/db'
import { writeAuditLog } from '@/lib/audit'
import {
  checkPaymentStatus as azamCheckPaymentStatus,
  probeTransactionStatus as azamProbeTransactionStatus,
} from '@/lib/psp/azampay'
import { suggestOrphanMatch, isPhoneMatch } from '@/lib/deposits/orphan-match'
import { formatDateTimeEAT } from '@/lib/format-date'
import { ReconciliationEntryForm } from './_components/ReconciliationEntryForm'
import { SafeMintActions } from './_components/SafeMintActions'
import { SupplyReconciliationCard } from './_components/SupplyReconciliationCard'
import { SubmitButton } from '../_components/SubmitButton'
import { BASE_RPC_URL, MINTER_PRIVATE_KEY, NTZS_CONTRACT_ADDRESS_BASE as NTZS_CONTRACT_ADDRESS, SNIPPE_API_KEY } from '@/lib/env'

const SAFE_MINT_THRESHOLD_TZS = 100000
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
  
  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
  const signer = new ethers.Wallet(MINTER_PRIVATE_KEY, provider)
  const contract = new ethers.Contract(NTZS_CONTRACT_ADDRESS, NTZS_ABI, signer)

  // Pre-flight: ensure minter wallet has enough ETH for gas
  const MIN_MINTER_ETH = ethers.parseEther('0.001')
  const minterBalance = await provider.getBalance(signer.address)
  if (minterBalance < MIN_MINTER_ETH) {
    console.error(
      `[Manual Mint] Minter wallet low on gas: ${ethers.formatEther(minterBalance)} ETH. ` +
      `Fund ${signer.address} on Base mainnet with at least 0.001 ETH.`
    )
    revalidatePath('/backstage/minting')
    return
  }

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

        await writeAuditLog('mint.executed', 'deposit_request', deposit.id, { amountTzs: deposit.amountTzs, walletAddress: deposit.walletAddress, txHash: receipt.hash })
        
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
    fail('Invalid deposit ID')
  }

  const { db } = getDb()

  const [deposit] = await db
    .select()
    .from(depositRequests)
    .where(eq(depositRequests.id, depositId))
    .limit(1)

  if (!deposit || deposit.status !== 'submitted') {
    fail('Deposit not found or not in submitted status')
  }

  // AzamPay deposits: the pasted reference is VERIFIED against AzamPay's own
  // status API (our bearer credentials) before crediting — the admin's copy
  // from their dashboard is a claim, TQS is the oracle. A reference can credit
  // at most one deposit.
  if (deposit.paymentProvider === 'azampay') {
    const ref = manualTransId || deposit.pspReference || ''
    if (!ref) {
      fail('Enter the AzamPay transaction reference from their dashboard')
    }
    const overrideReason = String(formData.get('overrideReason') ?? '').trim()
    let azamStatus = await azamCheckPaymentStatus(ref, deposit.pspChannel ?? undefined)
    let verifiedVariant: string | null = null
    let overrideEvidence: unknown = null
    if (azamStatus.status !== 'completed') {
      // A definitive negative can never be overridden — a FAILED payment on
      // their API contradicting an admin attestation is an escalation, not a
      // credit.
      if (azamStatus.status === 'failed' || azamStatus.status === 'expired') {
        fail(`AzamPay reports this reference as ${azamStatus.status} — cannot credit${azamStatus.raw ? ` (${azamStatus.raw})` : ''}`)
      }
      // Query-shape probe: their TQS has refused dashboard-verbatim ids.
      const probe = await azamProbeTransactionStatus(ref, deposit.pspChannel ?? undefined).catch(() => null)
      if (probe?.confirmed?.status === 'completed' && probe.variant) {
        azamStatus = probe.confirmed
        verifiedVariant = `${probe.variant.param}${probe.variant.provider ? `+provider=${probe.variant.provider}` : ' (no provider)'}`
      } else if (probe?.confirmed && (probe.confirmed.status === 'failed' || probe.confirmed.status === 'expired')) {
        fail(`AzamPay reports this reference as ${probe.confirmed.status} — cannot credit`)
      } else if (overrideReason.length >= 15) {
        // ATTESTATION OVERRIDE: production-proven case — their dashboard says
        // SUCCESS while their status API answers pending/not-found for the
        // same id. Super-admin attests to the dashboard record; the full probe
        // matrix is stored as evidence that verification was attempted and
        // their API could not confirm. Failed/expired verdicts above still
        // block this path.
        verifiedVariant = 'override'
        overrideEvidence = probe?.attempts ?? [{ canonical: azamStatus }]
      } else {
        const matrix = probe
          ? probe.attempts.map((a) => `${a.param}${a.provider ? `/${a.provider}` : ''}→${a.status}`).join(' · ')
          : `canonical→${azamStatus.status}`
        fail(
          `AzamPay did not confirm ${ref} — tried: ${matrix}. Last raw: ${(probe?.attempts.find((a) => a.raw)?.raw ?? azamStatus.raw) ?? 'n/a'}. If their dashboard shows SUCCESS, credit by attestation: keep the reference AND type an override reason of at least 15 characters (amount, date, operator ref), then Verify again.`
        )
      }
    }
    if (ref !== deposit.pspReference) {
      const [taken] = await db
        .select({ id: depositRequests.id })
        .from(depositRequests)
        .where(and(eq(depositRequests.pspReference, ref), ne(depositRequests.id, depositId)))
        .limit(1)
      if (taken) {
        fail(`This AzamPay reference already credits deposit ${taken.id}`)
      }
    }
    const currentUser = await getCurrentDbUser()
    const azamNewStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS ? 'mint_requires_safe' : 'mint_pending'
    const claimed = await db
      .update(depositRequests)
      .set({
        status: azamNewStatus,
        pspReference: ref,
        fiatConfirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(depositRequests.id, depositId), eq(depositRequests.status, 'submitted')))
      .returning({ id: depositRequests.id })
    if (claimed.length === 0) {
      fail('Deposit was just processed by another path — refresh')
    }
    const isOverride = verifiedVariant === 'override'
    await writeAuditLog(
      isOverride ? 'deposit.reconciled_override' : 'deposit.reconciled_manual',
      'deposit_request',
      depositId,
      {
        reference: ref,
        provider: 'azampay',
        verifiedVia: isOverride ? 'admin_attestation' : 'tqs',
        queryVariant: verifiedVariant,
        ...(isOverride ? { reason: overrideReason, tqsEvidence: overrideEvidence } : {}),
      },
      currentUser?.id
    )
    console.log(`[Admin] AzamPay ${isOverride ? 'OVERRIDE' : 'verified'} deposit ${depositId} -> ${azamNewStatus}`, { ref, verifiedVariant })
    succeed(
      isOverride
        ? `OVERRIDE — credited by attestation (${ref}). AzamPay's API could not confirm; the probe evidence and your reason are stored in the audit log.`
        : `AzamPay confirmed ${ref} — deposit queued to mint (${azamNewStatus.replace(/_/g, ' ')})${verifiedVariant ? ` · working query shape: ${verifiedVariant}` : ''}`
    )
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
    fail('Could not verify automatically. Enter the PSP transaction ID from the dashboard to proceed.')
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
  succeed(`Deposit advanced to ${newStatus.replace(/_/g, ' ')} (ref ${transid})`)
}

async function attachOrphanAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin'])
  const currentUser = await getCurrentDbUser()
  if (!currentUser) throw new Error('User not found')

  const orphanId = String(formData.get('orphanId') ?? '')
  const depositId = String(formData.get('depositId') ?? '')
  if (!orphanId || !depositId) throw new Error('Invalid parameters')

  const { db } = getDb()

  const [orphan] = await db.select().from(orphanPayments).where(eq(orphanPayments.id, orphanId)).limit(1)
  if (!orphan || orphan.status !== 'unmatched') throw new Error('Orphan payment not found or already reviewed')

  const [deposit] = await db.select().from(depositRequests).where(eq(depositRequests.id, depositId)).limit(1)
  if (!deposit || deposit.status !== 'submitted') throw new Error('Deposit not found or not in submitted status')

  // Mirror the webhook cross-checks: right currency, paid covers requested.
  if (orphan.currency !== 'TZS') throw new Error(`Cannot attach: orphan payment currency is ${orphan.currency}, not TZS`)
  if (orphan.amountTzs < deposit.amountTzs) throw new Error('Cannot attach: paid amount is less than the deposit request')

  // Claim the orphan first (conditional update) so two concurrent attaches
  // can never advance two deposits against one payment.
  const claimed = await db
    .update(orphanPayments)
    .set({
      status: 'matched',
      matchedDepositRequestId: deposit.id,
      reviewedByUserId: currentUser.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(orphanPayments.id, orphanId), eq(orphanPayments.status, 'unmatched')))
    .returning({ id: orphanPayments.id })
  if (claimed.length === 0) throw new Error('Orphan payment was just reviewed elsewhere')

  const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS ? 'mint_requires_safe' : 'mint_pending'
  const advanced = await db
    .update(depositRequests)
    .set({
      status: newStatus,
      pspReference: orphan.pspReference,
      pspChannel: orphan.channel ?? 'orphan_attach',
      buyerPhone: deposit.buyerPhone ?? orphan.payerPhone,
      fiatConfirmedAt: new Date(),
      fiatConfirmedByUserId: currentUser.id,
      updatedAt: new Date(),
    })
    .where(and(eq(depositRequests.id, depositId), eq(depositRequests.status, 'submitted')))
    .returning({ id: depositRequests.id })

  if (advanced.length === 0) {
    // Deposit changed under us — release the claim so the payment isn't stranded.
    await db
      .update(orphanPayments)
      .set({ status: 'unmatched', matchedDepositRequestId: null, reviewedByUserId: null, reviewedAt: null, updatedAt: new Date() })
      .where(and(eq(orphanPayments.id, orphanId), eq(orphanPayments.status, 'matched')))
    throw new Error('Deposit is no longer in submitted status; attach aborted')
  }

  await writeAuditLog(
    'deposit.orphan_attached',
    'deposit_request',
    deposit.id,
    { orphanPaymentId: orphan.id, pspReference: orphan.pspReference, paidTzs: orphan.amountTzs, newStatus },
    currentUser.id
  )

  console.log(`[Admin] Attached orphan payment ${orphan.id} (${orphan.pspReference}) to deposit ${deposit.id} -> ${newStatus}`)
  revalidatePath('/backstage/minting')
}

async function dismissOrphanAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin'])
  const currentUser = await getCurrentDbUser()
  if (!currentUser) throw new Error('User not found')

  const orphanId = String(formData.get('orphanId') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!orphanId) throw new Error('Invalid parameters')
  // A dismissed orphan is real money written off the review queue — always say why.
  if (!note) throw new Error('A note is required to dismiss (e.g. "refunded at PSP")')

  const { db } = getDb()
  const dismissed = await db
    .update(orphanPayments)
    .set({ status: 'dismissed', notes: note, reviewedByUserId: currentUser.id, reviewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(orphanPayments.id, orphanId), eq(orphanPayments.status, 'unmatched')))
    .returning({ id: orphanPayments.id })
  if (dismissed.length === 0) throw new Error('Orphan payment not found or already reviewed')

  await writeAuditLog('deposit.orphan_dismissed', 'orphan_payment', orphanId, { note }, currentUser.id)
  revalidatePath('/backstage/minting')
}

async function cancelSubmittedDepositAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin'])
  const currentUser = await getCurrentDbUser()
  if (!currentUser) throw new Error('User not found')

  const depositId = String(formData.get('depositId') ?? '')
  if (!depositId) throw new Error('Invalid deposit ID')

  const { db } = getDb()
  // Only 'submitted' rows (nothing confirmed, nothing minted) can be
  // cancelled — e.g. a duplicate attempt whose twin was paid and attached.
  const cancelled = await db
    .update(depositRequests)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(depositRequests.id, depositId), eq(depositRequests.status, 'submitted')))
    .returning({ id: depositRequests.id })
  if (cancelled.length === 0) throw new Error('Deposit not found or not in submitted status')

  await writeAuditLog('deposit.cancelled_stale', 'deposit_request', depositId, undefined, currentUser.id)
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

  // Do not mint unbacked tokens: approval may only advance a deposit whose fiat
  // has actually been confirmed, and only from a pre-mint state (never re-approve
  // one already queued / processing / minted).
  if (decision === 'approved') {
    if (!deposit.fiatConfirmedAt) {
      throw new Error('Cannot approve for minting: fiat has not been confirmed for this deposit')
    }
    if (['mint_pending', 'mint_requires_safe', 'mint_processing', 'minted'].includes(deposit.status)) {
      throw new Error(`Deposit is already ${deposit.status}; it cannot be re-approved`)
    }
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

  await writeAuditLog(`deposit.${decision}`, 'deposit_request', depositId, { decision, reason: reason || null, newStatus }, currentUser.id)

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

  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE || ''
  if (!contractAddress || !ethers.isAddress(contractAddress)) {
    return { success: false, error: 'Contract address not configured' }
  }

  const rpcUrl = process.env.BASE_RPC_URL || ''
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

  // Only mint_failed deposits are retryable. executeMint now only sets
  // mint_failed when NO tx was broadcast, so a mint_failed deposit is safe to
  // re-mint. Guarding on status also prevents a retry from resetting a deposit
  // that is minted, mint_processing, or left in mint_processing after an
  // unconfirmed broadcast — any of which would double-mint.
  const [dep] = await db
    .select({ id: depositRequests.id })
    .from(depositRequests)
    .where(and(eq(depositRequests.id, depositId), eq(depositRequests.status, 'mint_failed')))
    .limit(1)

  if (!dep) {
    revalidatePath('/backstage/minting')
    return
  }

  // Defense in depth (esp. for legacy mint_failed rows created before the
  // unconfirmed-broadcast fix): if a mint tx was already broadcast for this
  // deposit, verify on-chain before re-minting. If it confirmed, reconcile to
  // 'minted' instead of minting a second time; if we cannot check, refuse.
  const [mtx] = await db
    .select({ txHash: mintTransactions.txHash })
    .from(mintTransactions)
    .where(eq(mintTransactions.depositRequestId, depositId))
    .limit(1)

  if (mtx?.txHash && BASE_RPC_URL) {
    try {
      const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
      const receipt = await provider.getTransactionReceipt(mtx.txHash)
      if (receipt && receipt.status === 1) {
        await db.update(depositRequests).set({ status: 'minted', updatedAt: new Date() }).where(eq(depositRequests.id, depositId))
        await db.update(mintTransactions).set({ status: 'minted', error: null, updatedAt: new Date() }).where(eq(mintTransactions.depositRequestId, depositId))
        await writeAuditLog('mint.retry_reconciled_confirmed', 'deposit_request', depositId, { txHash: mtx.txHash })
        revalidatePath('/backstage/minting')
        return
      }
    } catch (e) {
      console.error('[retryMint] on-chain check failed; refusing to auto-retry to avoid double-mint', { depositId, txHash: mtx.txHash, error: e instanceof Error ? e.message : e })
      revalidatePath('/backstage/minting')
      return
    }
  }

  // No prior broadcast (or the broadcast tx did not confirm) → safe to re-queue.
  await db
    .update(depositRequests)
    .set({ status: 'mint_pending', updatedAt: new Date() })
    .where(and(eq(depositRequests.id, depositId), eq(depositRequests.status, 'mint_failed')))

  await db
    .update(mintTransactions)
    .set({ status: 'pending_retry', error: null, updatedAt: new Date() })
    .where(eq(mintTransactions.depositRequestId, depositId))

  revalidatePath('/backstage/minting')
}

type ReconciliationEntryType = 'untracked_mint' | 'test_mint' | 'manual_correction' | 'double_mint' | 'opening_balance' | 'other'

const TX_HASH_REQUIRED_TYPES: ReconciliationEntryType[] = ['untracked_mint', 'test_mint', 'double_mint']
const ADDRESS_REQUIRED_TYPES: ReconciliationEntryType[] = ['untracked_mint', 'test_mint', 'double_mint']

async function addReconciliationEntryAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin'])
  const currentUser = await getCurrentDbUser()
  if (!currentUser) throw new Error('User not found')

  const rawTxHash = String(formData.get('txHash') ?? '').trim()
  const rawToAddress = String(formData.get('toAddress') ?? '').trim()
  const rawContractAddress = String(formData.get('contractAddress') ?? '').trim()
  const amountTzs = Number(formData.get('amountTzs') ?? 0)
  const entryType = String(formData.get('entryType') ?? 'untracked_mint') as ReconciliationEntryType
  const reason = String(formData.get('reason') ?? '').trim()
  const notes = String(formData.get('notes') ?? '').trim() || null

  const needsTxHash = TX_HASH_REQUIRED_TYPES.includes(entryType)
  const needsAddress = ADDRESS_REQUIRED_TYPES.includes(entryType)

  if (needsTxHash && (!rawTxHash || !/^0x[0-9a-fA-F]{64}$/.test(rawTxHash))) {
    throw new Error('A valid transaction hash is required for this entry type')
  }
  if (needsAddress && (!rawToAddress || !ethers.isAddress(rawToAddress))) {
    throw new Error('A valid wallet address is required for this entry type')
  }
  const correctionTypes: ReconciliationEntryType[] = ['manual_correction', 'opening_balance', 'other']
  const allowNegative = correctionTypes.includes(entryType)
  if (!amountTzs || (!allowNegative && amountTzs <= 0)) {
    throw new Error('Invalid amount')
  }
  if (!reason) {
    throw new Error('Reason is required')
  }

  const txHash = needsTxHash ? rawTxHash : (rawTxHash || null)
  const toAddress = needsAddress ? rawToAddress : (rawToAddress || null)
  const contractAddress = rawContractAddress || null

  const { db } = getDb()

  await db.insert(reconciliationEntries).values({
    chain: 'base',
    txHash,
    toAddress,
    contractAddress,
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
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
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

async function getSnippeBalance(): Promise<number | null> {
  try {
    if (!SNIPPE_API_KEY) return null
    const resp = await fetch('https://api.snippe.sh/v1/payments/balance', {
      headers: { Authorization: `Bearer ${SNIPPE_API_KEY}` },
      next: { revalidate: 60 },
    })
    const text = await resp.text()
    if (!text || !text.trim()) return null
    const json = JSON.parse(text) as { status: string; data?: { available: number | { value: number } } }
    if (json.status !== 'success' || !json.data) return null
    const raw = json.data.available
    return typeof raw === 'object' ? Number((raw as { value: number }).value) : Number(raw)
  } catch (err) {
    console.error('[Minting] Failed to fetch Snippe balance:', err)
    return null
  }
}

const PROVIDER_LABEL: Record<string, string> = {
  azampay: 'AzamPay',
  snippe: 'Snippe',
  snippe_card: 'Snippe Card',
  selcom: 'Selcom',
  zenopay: 'ZenoPay',
  bank_transfer: 'Bank',
}
const PROVIDER_BADGE: Record<string, string> = {
  azampay: 'bg-sky-500/20 text-sky-400',
  snippe: 'bg-emerald-500/20 text-emerald-400',
  snippe_card: 'bg-teal-500/20 text-teal-400',
  selcom: 'bg-orange-500/20 text-orange-400',
  zenopay: 'bg-violet-500/20 text-violet-400',
}
const MOBILE_PROVIDERS = ['azampay', 'snippe', 'snippe_card', 'zenopay'] as const
const STALE_ATTEMPT_HOURS = 72

/** 'selcom' joins the stale-cancel scope only when a Selcom rail is enabled —
 * before drizzle/0061 the enum value doesn't exist in the DB and a WHERE
 * literal referencing it would error the whole action. */
function mobileProviderScope(): ('azampay' | 'snippe' | 'snippe_card' | 'zenopay' | 'selcom')[] {
  const selcomOn =
    process.env.SELCOM_COLLECTIONS_ENABLED === 'true' || process.env.SELCOM_W2B_ENABLED === 'true'
  return selcomOn ? [...MOBILE_PROVIDERS, 'selcom'] : [...MOBILE_PROVIDERS]
}

/**
 * Server-action refusals must surface as an inline banner — a thrown error in
 * a production server action takes down the whole page render (the black
 * "Application error" screen). Expected outcomes are never exceptions.
 */
function fail(message: string): never {
  redirect(`/backstage/minting?actionError=${encodeURIComponent(message)}`)
}

function succeed(message: string): never {
  revalidatePath('/backstage/minting')
  redirect(`/backstage/minting?actionOk=${encodeURIComponent(message)}`)
}

function timeAgo(d: Date | string): string {
  const ms = Date.now() - new Date(d as unknown as string).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/**
 * What "submitted" actually means for this row when no PSP evidence exists:
 * fresh mobile pushes are normal; old ones without any confirmation are
 * abandonment candidates; bank transfers legitimately wait for manual review.
 */
function defaultSubmittedNote(provider: string | null, createdAt: Date | string): string {
  if (!provider || provider === 'bank_transfer') return 'awaiting bank confirmation'
  const ageMin = (Date.now() - new Date(createdAt as unknown as string).getTime()) / 60_000
  return ageMin < 15 ? 'awaiting payment (push sent)' : 'no PSP confirmation yet'
}

/** Bulk-clear abandoned mobile-money attempts — provider-agnostic. */
async function cancelStaleMobileAttemptsAction() {
  'use server'

  await requireAnyRole(['super_admin'])
  const currentUser = await getCurrentDbUser()

  const { db } = getDb()
  const cutoff = new Date(Date.now() - STALE_ATTEMPT_HOURS * 3600_000)
  const cancelled = await db
    .update(depositRequests)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(depositRequests.status, 'submitted'),
        inArray(depositRequests.paymentProvider, mobileProviderScope()),
        lt(depositRequests.createdAt, cutoff)
      )
    )
    .returning({ id: depositRequests.id })

  await writeAuditLog('deposit.stale_attempts_cancelled', 'deposit_request', 'bulk', {
    count: cancelled.length,
    olderThanHours: STALE_ATTEMPT_HOURS,
    scope: 'mobile_money',
  }, currentUser?.id)

  console.log(`[Admin] cancelled ${cancelled.length} stale mobile-money attempts (> ${STALE_ATTEMPT_HOURS}h)`)
  succeed(`Cancelled ${cancelled.length} stale mobile-money attempt${cancelled.length === 1 ? '' : 's'} (>${STALE_ATTEMPT_HOURS}h)`)
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

export default async function MintingPage({
  searchParams,
}: {
  searchParams: Promise<{ actionError?: string; actionOk?: string }>
}) {
  const { actionError, actionOk } = await searchParams
  const { db } = getDb()

  // Fetch all deposit requests with related data including mint transaction info
  const [allDeposits, allReconciliationEntries, onChainSupply, snippeBalance] = await Promise.all([
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
        mintContractAddress: mintTransactions.contractAddress,
        paymentProvider: depositRequests.paymentProvider,
        pspReference: depositRequests.pspReference,
        pspChannel: depositRequests.pspChannel,
        buyerPhone: depositRequests.buyerPhone,
        source: depositRequests.source,
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
    getSnippeBalance(),
  ])

  // Orphan PSP payments awaiting review. Fail-soft: until migration
  // 0060_orphan_payments.sql is applied the table doesn't exist — render the
  // page without the section rather than erroring.
  let unmatchedOrphans: (typeof orphanPayments.$inferSelect)[] = []
  try {
    unmatchedOrphans = await db
      .select()
      .from(orphanPayments)
      .where(eq(orphanPayments.status, 'unmatched'))
      .orderBy(desc(orphanPayments.receivedAt))
      .limit(50)
  } catch {
    console.warn('[backstage/minting] orphan_payments unavailable (migration 0060 not applied yet?)')
  }

  const submittedCandidates = unmatchedOrphans.length
    ? await db
        .select({
          id: depositRequests.id,
          amountTzs: depositRequests.amountTzs,
          buyerPhone: depositRequests.buyerPhone,
          createdAt: depositRequests.createdAt,
          userEmail: users.email,
        })
        .from(depositRequests)
        .innerJoin(users, eq(depositRequests.userId, users.id))
        .where(eq(depositRequests.status, 'submitted'))
        .orderBy(desc(depositRequests.createdAt))
        .limit(200)
    : []

  // The PSP's own last answer per submitted deposit (recorded as audit
  // evidence by the poll/webhook) — turns "submitted" into an honest signal:
  // attempt vs paid-but-unresolved is visible per row, no exports needed.
  const pspAnswers = new Map<string, string>()
  try {
    const submittedIds = allDeposits.filter((d) => d.status === 'submitted').map((d) => d.id)
    if (submittedIds.length > 0) {
      const { sql: pgSql } = getDb()
      const evidenceRows = await pgSql<Array<{ entity_id: string; action: string; metadata: { raw?: string } | null }>>`
        select distinct on (entity_id) entity_id, action, metadata
          from audit_logs
         where entity_id = any(${submittedIds})
           and action in ('psp.tqs_unmapped', 'psp.webhook_unconfirmed', 'psp.webhook_ref_conflict')
         order by entity_id, created_at desc
      `
      for (const r of evidenceRows) {
        if (r.action === 'psp.tqs_unmapped') {
          pspAnswers.set(r.entity_id, `PSP can't resolve ref${r.metadata?.raw ? ` — ${r.metadata.raw.slice(0, 90)}` : ''}`)
        } else if (r.action === 'psp.webhook_unconfirmed') {
          pspAnswers.set(r.entity_id, 'callback received — unconfirmed, still verifying')
        } else if (r.action === 'psp.webhook_ref_conflict') {
          pspAnswers.set(r.entity_id, 'reference conflict — see Activity log')
        }
      }
    }
  } catch (err) {
    console.warn('[backstage/minting] PSP evidence lookup failed:', err instanceof Error ? err.message : err)
  }

  const staleCutoff = Date.now() - STALE_ATTEMPT_HOURS * 3600_000
  const staleAttempts = allDeposits.filter(
    (d) =>
      d.status === 'submitted' &&
      d.paymentProvider &&
      (MOBILE_PROVIDERS as readonly string[]).includes(d.paymentProvider) &&
      new Date(d.createdAt as unknown as string).getTime() < staleCutoff
  ).length

  const pendingApproval = allDeposits.filter(d => d.status === 'bank_approved').length
  const pendingMints = allDeposits.filter(d => d.status === 'mint_pending').length
  const totalMinted = allDeposits.filter(d => d.status === 'minted').length

  // Split minted deposits: current contract vs legacy wrong contracts
  const mintedOnCurrentContract = allDeposits
    .filter(d => d.status === 'minted' && d.mintContractAddress === NTZS_CONTRACT_ADDRESS)
  const mintedOnWrongContract = allDeposits
    .filter(d => d.status === 'minted' && d.mintContractAddress !== NTZS_CONTRACT_ADDRESS)

  const totalVolume = mintedOnCurrentContract.reduce((sum, d) => sum + d.amountTzs, 0)
  const wrongContractVolume = mintedOnWrongContract.reduce((sum, d) => sum + d.amountTzs, 0)
  
  // Reconciliation totals — only count mints on the current contract
  const reconciliationTotal = allReconciliationEntries.reduce((sum, e) => sum + e.amountTzs, 0)
  const dbTrackedTotal = totalVolume + reconciliationTotal
  const discrepancy = onChainSupply !== null ? onChainSupply - dbTrackedTotal : null

  // New reserve health formula: Snippe balance = PSP source of truth
  const dbMintedViaSnippeOnly = allDeposits
    .filter(d => d.status === 'minted' && (d.paymentProvider === 'snippe' || d.paymentProvider === 'snippe_card') && d.mintContractAddress === NTZS_CONTRACT_ADDRESS)
    .reduce((sum, d) => sum + d.amountTzs, 0)

  const pendingMintsTzs = allDeposits
    .filter(d => d.status === 'mint_pending' || d.status === 'bank_approved')
    .reduce((sum, d) => sum + d.amountTzs, 0)

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
              <SubmitButton
                pendingText="Processing..."
                className="rounded-lg bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/30"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Process {pendingMints} Pending Mint{pendingMints !== 1 ? 's' : ''}
              </SubmitButton>
            </form>
          )}
        </div>
      </div>

      <div className="p-8">
        {actionError ? (
          <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
            <p className="text-sm font-medium text-rose-400">Action refused</p>
            <p className="mt-1 break-all font-mono text-xs text-rose-300/90">{actionError}</p>
          </div>
        ) : null}
        {actionOk ? (
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
            {actionOk}
          </div>
        ) : null}

        {/* Supply Reconciliation */}
        <div className="mb-6">
          <SupplyReconciliationCard
            onChainSupply={onChainSupply}
            snippeBalance={snippeBalance}
            dbMintedViaSnippeOnly={dbMintedViaSnippeOnly}
            pendingMintsTzs={pendingMintsTzs}
          />
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
        {staleAttempts > 0 && (
          <div className="mb-3 flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <p className="text-sm text-zinc-400">
              <span className="font-medium text-amber-400">{staleAttempts}</span> mobile-money attempts have sat
              in <span className="text-zinc-300">submitted</span> for over {STALE_ATTEMPT_HOURS}h with no payment —
              abandonment noise. Verify any you believe were paid first; then clear the rest.
            </p>
            <form action={cancelStaleMobileAttemptsAction}>
              <SubmitButton className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-300 hover:bg-amber-500/20">
                Cancel {staleAttempts} stale attempt{staleAttempts !== 1 ? 's' : ''}
              </SubmitButton>
            </form>
          </div>
        )}
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
                        <div className="mt-0.5 whitespace-nowrap text-xs text-zinc-500">
                          {formatDateTimeEAT(dep.createdAt)} · {timeAgo(dep.createdAt)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-mono text-lg font-bold text-emerald-400">
                          {dep.amountTzs.toLocaleString()}
                        </div>
                        <div className="text-xs text-zinc-500">TZS</div>
                      </td>
                      <td className="px-6 py-4">
                        {dep.paymentProvider && dep.paymentProvider !== 'bank_transfer' ? (
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${PROVIDER_BADGE[dep.paymentProvider] ?? 'bg-zinc-500/20 text-zinc-300'}`}>
                                {PROVIDER_LABEL[dep.paymentProvider] ?? dep.paymentProvider}
                              </span>
                              {dep.pspChannel && (
                                <span className="text-xs text-zinc-500">{dep.pspChannel}</span>
                              )}
                              {dep.source && dep.source !== 'self' && (
                                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                                  {dep.source.replace(/_/g, ' ')}
                                </span>
                              )}
                            </div>
                            {dep.buyerPhone && (
                              <div className="mt-1 font-mono text-xs text-zinc-400">{dep.buyerPhone}</div>
                            )}
                            {dep.pspReference && (
                              <code className="mt-1 block max-w-[210px] truncate rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-emerald-400" title={dep.pspReference}>
                                {dep.pspReference}
                              </code>
                            )}
                          </div>
                        ) : (
                          <div>
                            <span className="text-sm text-zinc-400">{dep.bankName}</span>
                            {dep.source && dep.source !== 'self' && (
                              <div className="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">{dep.source.replace(/_/g, ' ')}</div>
                            )}
                          </div>
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
                        {dep.status === 'submitted' && (
                          <p
                            className="mt-1 max-w-[190px] truncate text-xs text-zinc-500"
                            title={pspAnswers.get(dep.id) ?? defaultSubmittedNote(dep.paymentProvider, dep.createdAt)}
                          >
                            {pspAnswers.get(dep.id) ?? defaultSubmittedNote(dep.paymentProvider, dep.createdAt)}
                          </p>
                        )}
                        {dep.mintError && (
                          <p className="mt-1 text-xs text-rose-400 max-w-[150px] truncate" title={dep.mintError}>
                            {dep.mintError}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {dep.txHash ? (
                          <a
                            href={`https://basescan.org/tx/${dep.txHash}`}
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
                              <SubmitButton
                                pendingText="Approving..."
                                className="rounded-lg bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20"
                              >
                                Approve Mint
                              </SubmitButton>
                            </form>
                            <form action={approveDepositAction}>
                              <input type="hidden" name="depositId" value={dep.id} />
                              <input type="hidden" name="decision" value="rejected" />
                              <SubmitButton
                                pendingText="Rejecting..."
                                className="rounded-lg bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-400 hover:bg-rose-500/20"
                              >
                                Reject
                              </SubmitButton>
                            </form>
                          </div>
                        ) : dep.status === 'mint_failed' ? (
                          <form action={retryMintAction}>
                            <input type="hidden" name="depositId" value={dep.id} />
                            <SubmitButton
                              pendingText="Retrying..."
                              className="rounded-lg bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/20"
                            >
                              Retry Mint
                            </SubmitButton>
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
                            contractAddress={process.env.NTZS_CONTRACT_ADDRESS_BASE || ''}
                            chainId="8453"
                            onConfirm={confirmSafeMintAction}
                          />
                        ) : dep.status === 'submitted' ? (
                          <div className="flex flex-col gap-1.5">
                            <form action={verifyAndAdvanceSubmittedAction} className="flex flex-col gap-1.5">
                              <input type="hidden" name="depositId" value={dep.id} />
                              <input
                                type="text"
                                name="manualTransId"
                                placeholder="PSP Trans ID"
                                className="rounded bg-zinc-800 px-2 py-1 text-xs text-white placeholder:text-zinc-600 border border-zinc-700 focus:border-emerald-500/50 outline-none w-32"
                              />
                              {dep.paymentProvider === 'azampay' && (
                                <input
                                  type="text"
                                  name="overrideReason"
                                  placeholder="Override reason (only if their dashboard says SUCCESS)"
                                  title="Attestation override: used only when AzamPay's status API cannot confirm a payment their dashboard shows as SUCCESS. Min 15 characters — include amount, date, operator ref."
                                  className="rounded bg-zinc-800 px-2 py-1 text-xs text-white placeholder:text-zinc-600 border border-amber-700/40 focus:border-amber-500/60 outline-none w-48"
                                />
                              )}
                              <SubmitButton
                                pendingText="Verifying..."
                                className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20"
                              >
                                Verify & Advance
                              </SubmitButton>
                            </form>
                            <form action={cancelSubmittedDepositAction}>
                              <input type="hidden" name="depositId" value={dep.id} />
                              <SubmitButton
                                pendingText="Cancelling..."
                                className="rounded-lg bg-zinc-500/10 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-500/20"
                              >
                                Cancel
                              </SubmitButton>
                            </form>
                          </div>
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

        {/* Orphan PSP payments — money at the PSP with no linked deposit */}
        {unmatchedOrphans.length > 0 && (
          <div className="mt-8 rounded-2xl border border-amber-500/20 bg-zinc-900/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h3 className="text-lg font-semibold text-white">Unmatched PSP payments ({unmatchedOrphans.length})</h3>
              <p className="text-sm text-zinc-400">
                Completed payments that arrived without a deposit reference (e.g. paid directly to the
                collection till). Attach each to the matching submitted deposit to credit the user, or
                dismiss with a note.
              </p>
            </div>
            <div className="divide-y divide-white/5">
              {unmatchedOrphans.map((orphan) => {
                const { exact, candidates } = suggestOrphanMatch(orphan, submittedCandidates)
                return (
                  <div key={orphan.id} className="px-6 py-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <div className="font-mono text-lg font-bold text-amber-400">
                        {orphan.amountTzs.toLocaleString()}{' '}
                        <span className="text-xs font-normal text-zinc-500">{orphan.currency}</span>
                      </div>
                      <div className="text-sm text-zinc-300">
                        {orphan.payerName || 'Unknown payer'}
                        {orphan.payerPhone ? <span className="text-zinc-500"> · {orphan.payerPhone}</span> : null}
                      </div>
                      <code className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-emerald-400" title={orphan.pspReference}>
                        {orphan.pspReference}
                      </code>
                      {orphan.channel && <span className="text-xs text-zinc-500">{orphan.channel}</span>}
                      <span className="text-xs text-zinc-500">{formatDateTimeEAT(orphan.receivedAt)}</span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {candidates.length === 0 ? (
                        <span className="text-sm text-zinc-500">
                          No submitted deposit matches this amount — verify at the PSP, then dismiss or wait
                          for the user to create a deposit request.
                        </span>
                      ) : (
                        candidates.map((c) => (
                          <form key={c.id} action={attachOrphanAction}>
                            <input type="hidden" name="orphanId" value={orphan.id} />
                            <input type="hidden" name="depositId" value={c.id} />
                            <SubmitButton
                              pendingText="Attaching..."
                              className={
                                exact?.id === c.id
                                  ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25'
                                  : 'rounded-lg border border-white/10 bg-zinc-500/10 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-500/20'
                              }
                            >
                              Attach to {c.userEmail}
                              {isPhoneMatch(orphan, c) ? ' ✓ phone match' : ''}
                            </SubmitButton>
                          </form>
                        ))
                      )}
                      <form action={dismissOrphanAction} className="ml-auto flex items-center gap-1.5">
                        <input type="hidden" name="orphanId" value={orphan.id} />
                        <input
                          type="text"
                          name="note"
                          placeholder="Dismiss note (e.g. refunded)"
                          className="w-44 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-rose-500/50"
                        />
                        <SubmitButton
                          pendingText="Dismissing..."
                          className="rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20"
                        >
                          Dismiss
                        </SubmitButton>
                      </form>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Reconciliation Section — always visible */}
        <div className="mt-8 space-y-6">
          <ReconciliationEntryForm
            addReconciliationEntryAction={addReconciliationEntryAction}
            discrepancy={discrepancy}
            contractAddress={NTZS_CONTRACT_ADDRESS}
          />

          {/* Reconciliation Entries Table */}
          {allReconciliationEntries.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-zinc-900/50 overflow-hidden">
              <div className="px-6 py-4 border-b border-white/10">
                <h3 className="text-lg font-semibold text-white">Reconciliation Entries</h3>
                <p className="text-sm text-zinc-400">Supply events not linked to deposit requests</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-zinc-900/80">
                    <tr className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                      <th className="px-6 py-4">Type</th>
                      <th className="px-6 py-4">Amount</th>
                      <th className="px-6 py-4">To Address</th>
                      <th className="px-6 py-4">Contract</th>
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
                          {entry.toAddress ? (
                            <code className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-300">
                              {entry.toAddress.slice(0, 6)}...{entry.toAddress.slice(-4)}
                            </code>
                          ) : (
                            <span className="text-xs text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {entry.contractAddress ? (
                            <code className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-400">
                              {entry.contractAddress.slice(0, 6)}...{entry.contractAddress.slice(-4)}
                            </code>
                          ) : (
                            <span className="text-xs text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm text-white">{entry.reason}</p>
                          {entry.notes && <p className="text-xs text-zinc-500 mt-1">{entry.notes}</p>}
                        </td>
                        <td className="px-6 py-4">
                          {entry.txHash ? (
                            <a
                              href={`https://basescan.org/tx/${entry.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-cyan-400 hover:underline"
                            >
                              {entry.txHash.slice(0, 10)}...
                            </a>
                          ) : (
                            <span className="text-xs text-zinc-600">—</span>
                          )}
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
      </div>
    </div>
  )
}
