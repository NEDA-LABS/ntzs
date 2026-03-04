import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { sendPayout, sendBankPayout } from '@/lib/psp/snippe'
import { deriveTreasuryWallet } from '@/lib/waas/hd-wallets'
import { partners } from '@ntzs/db'

const MIN_WITHDRAW_TZS = 5000

function verifySessionToken(token: string): string | null {
  const secret = process.env.APP_SECRET || 'dev-secret-do-not-use'
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [encoded, sig] = parts
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded!).digest('base64url')
  if (sig!.length !== expectedSig.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig!, 'utf8'), Buffer.from(expectedSig, 'utf8'))) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'))
    if (payload.exp && payload.exp < Date.now()) return null
    return payload.pid || null
  } catch {
    return null
  }
}

/**
 * POST /api/v1/partners/treasury/withdraw
 * Initiate a treasury withdrawal to the configured mobile money number via Snippe.
 * Body: { amountTzs: number }
 * Minimum: 5,000 TZS
 */
export async function POST(request: NextRequest) {
  const cookieToken = request.cookies.get('partner_session')?.value
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = cookieToken || bearerToken

  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const partnerId = verifySessionToken(token)
  if (!partnerId) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })

  let body: { amountTzs: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { amountTzs } = body

  if (!amountTzs || typeof amountTzs !== 'number') {
    return NextResponse.json({ error: 'amountTzs is required' }, { status: 400 })
  }

  if (amountTzs < MIN_WITHDRAW_TZS) {
    return NextResponse.json(
      { error: `Minimum withdrawal is ${MIN_WITHDRAW_TZS.toLocaleString()} TZS` },
      { status: 400 }
    )
  }

  const { db } = getDb()

  const [partner] = await db
    .select({
      id: partners.id,
      name: partners.name,
      email: partners.email,
      payoutPhone: partners.payoutPhone,
      payoutType: partners.payoutType,
      payoutBankAccount: partners.payoutBankAccount,
      payoutBankName: partners.payoutBankName,
      encryptedHdSeed: partners.encryptedHdSeed,
      treasuryWalletAddress: partners.treasuryWalletAddress,
      webhookUrl: partners.webhookUrl,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)

  if (!partner) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  }

  const isMobile = partner.payoutType === 'mobile' || !partner.payoutType
  const isBank = partner.payoutType === 'bank'

  if (isMobile && !partner.payoutPhone) {
    return NextResponse.json(
      { error: 'No payout destination configured. Please set your mobile money number or bank account first.' },
      { status: 400 }
    )
  }
  if (isBank && (!partner.payoutBankAccount || !partner.payoutBankName)) {
    return NextResponse.json(
      { error: 'Bank account details are incomplete. Please reconfigure your payout destination.' },
      { status: 400 }
    )
  }
  if (!isMobile && !isBank) {
    return NextResponse.json(
      { error: 'No payout destination configured. Please set your mobile money number or bank account first.' },
      { status: 400 }
    )
  }

  if (!partner.encryptedHdSeed || !partner.treasuryWalletAddress) {
    return NextResponse.json({ error: 'Treasury wallet not provisioned' }, { status: 400 })
  }

  // Verify on-chain treasury balance
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL
  const contractAddress =
    process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.NTZS_CONTRACT_ADDRESS_BASE

  if (!rpcUrl || !contractAddress) {
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const token = new ethers.Contract(
      contractAddress,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    )
    const balanceWei: bigint = await token.balanceOf(partner.treasuryWalletAddress)
    const balanceTzs = Number(balanceWei / BigInt(10) ** BigInt(18))

    if (balanceTzs < amountTzs) {
      return NextResponse.json(
        { error: `Insufficient treasury balance. Available: ${balanceTzs.toLocaleString()} TZS` },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error('[treasury/withdraw] Balance check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to verify treasury balance' }, { status: 500 })
  }

  const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || ''
  const webhookUrl = partner.webhookUrl || `${baseUrl}/api/v1/webhooks/snippe`
  const sharedMeta = { partnerId: partner.id, partnerName: partner.name, type: 'treasury_withdrawal' }

  let result
  let successMessage: string

  if (isBank) {
    result = await sendBankPayout({
      amountTzs,
      recipientName: partner.name,
      bankAccount: partner.payoutBankAccount!,
      bankName: partner.payoutBankName!,
      narration: `nTZS treasury withdrawal - ${partner.name}`,
      webhookUrl,
      metadata: sharedMeta,
    })
    successMessage = `Withdrawal of ${amountTzs.toLocaleString()} TZS initiated to ${partner.payoutBankName} account ending ${partner.payoutBankAccount!.slice(-4)}. Funds will arrive within 1-2 business days.`
  } else {
    result = await sendPayout({
      amountTzs,
      recipientPhone: partner.payoutPhone!,
      recipientName: partner.name,
      narration: `nTZS treasury withdrawal - ${partner.name}`,
      webhookUrl,
      metadata: sharedMeta,
    })
    successMessage = `Withdrawal of ${amountTzs.toLocaleString()} TZS initiated to ${partner.payoutPhone}. You will receive an M-Pesa prompt shortly.`
  }

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || 'Payout initiation failed' },
      { status: 502 }
    )
  }

  return NextResponse.json({
    reference: result.reference,
    externalReference: result.externalReference,
    amountTzs,
    fees: result.fees,
    total: result.total,
    message: successMessage,
  })
}
