import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, MINTER_PRIVATE_KEY, BURNER_PRIVATE_KEY } from '@/lib/env'
import { authenticatePartner } from '@/lib/waas/auth'
import { isValidTanzanianPhone } from '@/lib/psp/snippe'
import { wallets, partnerUsers, burnRequests } from '@ntzs/db'

const SAFE_MINT_THRESHOLD_TZS = 100000
const SNIPPE_API_KEY = process.env.SNIPPE_API_KEY || ''
const SNIPPE_BASE_URL = 'https://api.snippe.sh'
const APP_URL = process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || ''

const NTZS_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const
const NTZS_BURN_ABI = [
  'function burn(address from, uint256 amount)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
] as const

/**
 * POST /api/v1/withdrawals — Initiate nTZS burn + Snippe payout to M-Pesa (off-ramp)
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult

  let body: { userId: string; amountTzs: number; phoneNumber: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { userId, amountTzs, phoneNumber } = body

  if (!userId || !amountTzs || !phoneNumber) {
    return NextResponse.json(
      { error: 'userId, amountTzs, and phoneNumber are required' },
      { status: 400 }
    )
  }

  if (amountTzs < 5000) {
    return NextResponse.json(
      { error: 'Minimum withdrawal amount is 5,000 TZS' },
      { status: 400 }
    )
  }

  if (!isValidTanzanianPhone(phoneNumber)) {
    return NextResponse.json(
      { error: 'Invalid Tanzanian phone number' },
      { status: 400 }
    )
  }

  const { db } = getDb()

  // Verify user belongs to this partner
  const [mapping] = await db
    .select({ externalId: partnerUsers.externalId })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, userId)))
    .limit(1)

  if (!mapping) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Get wallet
  const [wallet] = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'base')))
    .limit(1)

  if (!wallet || wallet.address.startsWith('0x_pending_')) {
    return NextResponse.json(
      { error: 'User wallet is not provisioned yet' },
      { status: 400 }
    )
  }

  // Check on-chain balance
  const rpcUrl = BASE_RPC_URL
  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE

  if (!rpcUrl || !contractAddress) {
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const token = new ethers.Contract(contractAddress, NTZS_BALANCE_ABI, provider)
    const balanceWei: bigint = await token.balanceOf(wallet.address)
    const balanceTzs = Number(balanceWei / (BigInt(10) ** BigInt(18)))

    if (balanceTzs < amountTzs) {
      return NextResponse.json(
        { error: `Insufficient balance. Available: ${balanceTzs} TZS, requested: ${amountTzs} TZS` },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error('[v1/withdrawals] Balance check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to verify balance' }, { status: 500 })
  }

  // Large amounts require admin approval — queue and return
  if (amountTzs >= SAFE_MINT_THRESHOLD_TZS) {
    const [burn] = await db
      .insert(burnRequests)
      .values({
        userId,
        walletId: wallet.id,
        chain: 'base',
        contractAddress,
        amountTzs,
        reason: 'WaaS withdrawal',
        status: 'requested',
        requestedByUserId: userId,
        recipientPhone: phoneNumber,
      })
      .returning({ id: burnRequests.id, status: burnRequests.status, amountTzs: burnRequests.amountTzs })

    if (!burn) {
      return NextResponse.json({ error: 'Failed to create withdrawal request' }, { status: 500 })
    }

    return NextResponse.json(
      { id: burn.id, status: burn.status, amountTzs: burn.amountTzs, message: 'Withdrawal requires admin approval for amounts >= 100,000 TZS.' },
      { status: 201 }
    )
  }

  // Small amounts: execute burn inline immediately
  const burnerKey = BURNER_PRIVATE_KEY || MINTER_PRIVATE_KEY
  if (!burnerKey) {
    return NextResponse.json({ error: 'Burn executor not configured' }, { status: 500 })
  }

  // Create burn request in burn_submitted state
  const [burn] = await db
    .insert(burnRequests)
    .values({
      userId,
      walletId: wallet.id,
      chain: 'base',
      contractAddress,
      amountTzs,
      reason: 'WaaS withdrawal',
      status: 'burn_submitted',
      requestedByUserId: userId,
      recipientPhone: phoneNumber,
    })
    .returning({ id: burnRequests.id, amountTzs: burnRequests.amountTzs })

  if (!burn) {
    return NextResponse.json({ error: 'Failed to create withdrawal request' }, { status: 500 })
  }

  const burnRequestId = burn.id

  // Execute burn on-chain
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const signer = new ethers.Wallet(burnerKey, provider)
    const token = new ethers.Contract(contractAddress, NTZS_BURN_ABI, signer)

    const burnerRole: string = await token.BURNER_ROLE()
    const hasBurner: boolean = await token.hasRole(burnerRole, await signer.getAddress())
    if (!hasBurner) {
      await db.update(burnRequests).set({ status: 'failed', error: 'Burn key lacks BURNER_ROLE', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
      return NextResponse.json({ error: 'Burn executor not configured correctly' }, { status: 500 })
    }

    const amountWei = BigInt(String(amountTzs)) * BigInt(10) ** BigInt(18)
    const tx = await token.burn(wallet.address, amountWei)

    await db.update(burnRequests).set({ txHash: tx.hash, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))

    await tx.wait(1)

    await db.update(burnRequests).set({ status: 'burned', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db.update(burnRequests).set({ status: 'failed', error: errorMessage, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
    console.error('[v1/withdrawals] Burn failed:', errorMessage)
    return NextResponse.json({ error: 'Burn failed', detail: errorMessage }, { status: 500 })
  }

  // Trigger Snippe payout
  if (SNIPPE_API_KEY) {
    let phone = phoneNumber.replace(/[\s\-+]/g, '')
    if (phone.startsWith('0')) phone = '255' + phone.substring(1)
    if (!phone.startsWith('255')) phone = '255' + phone

    const webhookUrl = `${APP_URL}/api/webhooks/snippe/payout`

    try {
      const payoutResp = await fetch(`${SNIPPE_BASE_URL}/v1/payouts/send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SNIPPE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountTzs,
          channel: 'mobile',
          recipient_phone: phone,
          recipient_name: 'nTZS User',
          narration: 'nTZS withdrawal',
          ...(webhookUrl.startsWith('https://') ? { webhook_url: webhookUrl } : {}),
          metadata: { burn_request_id: burnRequestId },
        }),
      })
      const payoutResult = await payoutResp.json() as { status: string; message?: string; data?: { reference: string } }

      if (payoutResult.status === 'success' && payoutResult.data?.reference) {
        const payoutRef = payoutResult.data.reference
        await db.update(burnRequests).set({ payoutReference: payoutRef, payoutStatus: 'pending', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))

        // Poll Snippe for completion — don't rely solely on webhook
        // Checks at 3s, 6s, 12s intervals to catch quick completions
        void (async () => {
          const delays = [3000, 6000, 12000]
          for (const delay of delays) {
            await new Promise((r) => setTimeout(r, delay))
            try {
              const statusResp = await fetch(`${SNIPPE_BASE_URL}/v1/payouts/${payoutRef}`, {
                headers: { 'Authorization': `Bearer ${SNIPPE_API_KEY}` },
                signal: AbortSignal.timeout(5000),
              })
              const statusResult = await statusResp.json() as { status: string; data?: { status: string; failure_reason?: string } }
              if (statusResult.status !== 'success' || !statusResult.data) continue
              const ps = statusResult.data.status
              if (ps === 'completed') {
                await db.update(burnRequests).set({ payoutStatus: 'completed', status: 'burned', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
                console.log(`[v1/withdrawals] Payout ${payoutRef} completed (polled)`)
                break
              } else if (ps === 'failed' || ps === 'reversed') {
                await db.update(burnRequests).set({ payoutStatus: 'failed', payoutError: statusResult.data.failure_reason || 'Payout failed', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
                console.warn(`[v1/withdrawals] Payout ${payoutRef} failed (polled): ${statusResult.data.failure_reason}`)
                break
              }
            } catch {
              // Continue to next poll interval
            }
          }
        })()
      } else {
        await db.update(burnRequests).set({ payoutStatus: 'failed', payoutError: payoutResult.message ?? 'Payout initiation failed', updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
        console.error('[v1/withdrawals] Payout failed:', payoutResult.message)
      }
    } catch (payoutErr) {
      const msg = payoutErr instanceof Error ? payoutErr.message : String(payoutErr)
      await db.update(burnRequests).set({ payoutStatus: 'failed', payoutError: msg, updatedAt: new Date() }).where(eq(burnRequests.id, burnRequestId))
      console.error('[v1/withdrawals] Payout error:', msg)
    }
  }

  return NextResponse.json(
    { id: burnRequestId, status: 'burned', amountTzs: burn.amountTzs, message: 'Withdrawal processed successfully.' },
    { status: 201 }
  )
}
