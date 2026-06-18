import crypto from 'crypto'
import { ethers } from 'ethers'
import { eq, and, inArray, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL } from '@/lib/env'
import { rampSettlements, depositRequests, banks, users, wallets, partners, lpAccounts, lpFills } from '@ntzs/db'
import { executeSwap, selectLPForSwap, SWAP_TOKENS, type LPConfig } from '@/lib/fx/swap'
import { initiatePayment } from '@/lib/psp'
import { queuePartnerWebhook } from '@/lib/waas/partner-webhooks'
import { getOrCreateSettlementWallet, getSettlementSigner } from '@/lib/ramp/wallet'

const PRODUCTION_URL = 'https://www.ntzs.co.tz'
const webhookBase = () => process.env.NTZS_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || PRODUCTION_URL

async function setStatus(settlementId: string, patch: Record<string, unknown>) {
  const { db } = getDb()
  await db.update(rampSettlements).set({ ...patch, updatedAt: new Date() }).where(eq(rampSettlements.id, settlementId))
}

/** Synthetic platform user + wallet for the settlement address (deposit FK bookkeeping). */
async function resolveRampUserWallet(settlementAddress: string): Promise<{ userId: string; walletId: string } | null> {
  const { db } = getDb()
  const neonId = `ramp_${settlementAddress.toLowerCase()}`
  let [u] = await db.select({ id: users.id }).from(users).where(eq(users.neonAuthUserId, neonId)).limit(1)
  if (!u) {
    const [c] = await db.insert(users).values({ neonAuthUserId: neonId, email: `ramp+${settlementAddress.toLowerCase()}@nedapay.internal`, role: 'end_user' }).onConflictDoNothing().returning({ id: users.id })
    u = c ?? (await db.select({ id: users.id }).from(users).where(eq(users.neonAuthUserId, neonId)).limit(1))[0]
  }
  if (!u) return null
  let [w] = await db.select({ id: wallets.id }).from(wallets).where(and(eq(wallets.userId, u.id), eq(wallets.chain, 'base'))).limit(1)
  if (!w) {
    const [c] = await db.insert(wallets).values({ userId: u.id, chain: 'base', address: settlementAddress, provider: 'external' }).onConflictDoNothing().returning({ id: wallets.id })
    w = c ?? (await db.select({ id: wallets.id }).from(wallets).where(and(eq(wallets.userId, u.id), eq(wallets.chain, 'base'))).limit(1))[0]
  }
  if (!w) return null
  return { userId: u.id, walletId: w.id }
}

/**
 * Initiate an on-ramp: collect TZS from the payer via mobile money. The existing
 * payment webhook → executeMint pipeline mints nTZS to the settlement wallet;
 * the ramp-settle cron then swaps it to USDC (runOnrampSwapLeg).
 */
export async function initiateOnramp(args: {
  partnerId: string
  settlementId: string
  settlementAddress: string
  tzsAmount: number
  payerPhone: string
}): Promise<{ ok: boolean; depositId?: string; error?: string }> {
  const { db, sql: rawSql } = getDb()
  const { settlementId, settlementAddress } = args

  const fk = await resolveRampUserWallet(settlementAddress)
  if (!fk) { await setStatus(settlementId, { status: 'failed', error: 'bookkeeping user' }); return { ok: false, error: 'Internal: bookkeeping user' } }

  // Sentinel bank for ramp deposits.
  const bankRows = await rawSql<{ id: string }[]>`
    insert into banks (name, status) values ('Ramp API', 'active')
    on conflict (name) do update set status = 'active' returning id
  `
  const bankId = bankRows[0]?.id
  if (!bankId) { await setStatus(settlementId, { status: 'failed', error: 'bank' }); return { ok: false, error: 'Internal: bank' } }

  const [deposit] = await db.insert(depositRequests).values({
    userId: fk.userId,
    bankId,
    walletId: fk.walletId,
    chain: 'base',
    amountTzs: args.tzsAmount,
    status: 'submitted',
    idempotencyKey: crypto.randomUUID(),
    paymentProvider: 'snippe',
    buyerPhone: args.payerPhone,
    source: 'ramp',
    rampSettlementId: settlementId,
  }).returning({ id: depositRequests.id })
  if (!deposit) { await setStatus(settlementId, { status: 'failed', error: 'deposit insert' }); return { ok: false, error: 'Internal: deposit' } }

  await setStatus(settlementId, { depositRequestId: deposit.id, status: 'minting' })

  const result = await initiatePayment({
    amountTzs: args.tzsAmount,
    phoneNumber: args.payerPhone,
    customerEmail: `ramp+${settlementAddress.toLowerCase()}@nedapay.internal`,
    webhookUrl: `${webhookBase()}/api/webhooks/snippe/payment`,
    metadata: { deposit_request_id: deposit.id },
  })

  if (!result.success) {
    await db.update(depositRequests).set({ status: 'rejected', updatedAt: new Date() }).where(eq(depositRequests.id, deposit.id))
    await setStatus(settlementId, { status: 'failed', error: result.error ?? 'Payment initiation failed' })
    return { ok: false, error: result.error ?? 'Failed to initiate mobile-money collection' }
  }

  await db.update(depositRequests).set({ pspReference: result.reference, updatedAt: new Date() }).where(eq(depositRequests.id, deposit.id))
  await setStatus(settlementId, { pspReference: result.reference })
  return { ok: true, depositId: deposit.id }
}

/**
 * Post-mint leg of an on-ramp: nTZS has been minted to the settlement wallet —
 * swap it to USDC (delivered to the partner's destination address, or kept in
 * the settlement float). Driven by the ramp-settle cron once the deposit mints.
 */
export async function runOnrampSwapLeg(settlementId: string): Promise<{ ok: boolean; status: string; error?: string }> {
  const { db } = getDb()

  const [s] = await db.select().from(rampSettlements).where(eq(rampSettlements.id, settlementId)).limit(1)
  if (!s || s.direction !== 'onramp' || s.status !== 'minting') return { ok: false, status: s?.status ?? 'unknown', error: 'not in minting state' }

  const rpcUrl = BASE_RPC_URL
  const solverPrivateKey = process.env.SOLVER_PRIVATE_KEY as `0x${string}` | undefined
  const solverAddress = (process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646') as `0x${string}`
  if (!rpcUrl || !solverPrivateKey) { await setStatus(settlementId, { status: 'failed', error: 'executor not configured' }); return { ok: false, status: 'failed', error: 'executor not configured' } }

  const [partner] = await db.select({ encryptedHdSeed: partners.encryptedHdSeed }).from(partners).where(eq(partners.id, s.partnerId)).limit(1)
  if (!partner?.encryptedHdSeed) { await setStatus(settlementId, { status: 'failed', error: 'partner seed' }); return { ok: false, status: 'failed', error: 'partner seed' } }

  const wallet = await getOrCreateSettlementWallet(s.partnerId)
  const tzsAmount = s.tzsAmount
  const usdcAmount = Number(s.usdcAmount)

  // nTZS must be present (minted) before we swap.
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const ntzs = new ethers.Contract(SWAP_TOKENS.NTZS.address, ['function balanceOf(address) view returns (uint256)'], provider)
  const bal: bigint = await ntzs.balanceOf(wallet.address)
  if (bal < ethers.parseUnits(String(tzsAmount), SWAP_TOKENS.NTZS.decimals)) {
    return { ok: false, status: 'minting', error: 'nTZS not yet minted to settlement wallet' }
  }

  // Pick an LP for nTZS→USDC.
  const active = await db.select({ id: lpAccounts.id, bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps }).from(lpAccounts).where(eq(lpAccounts.isActive, true))
  if (active.length === 0) { await setStatus(settlementId, { status: 'failed', error: 'no active LP' }); return { ok: false, status: 'failed', error: 'no active LP' } }
  const configs: LPConfig[] = active.map((l) => ({ id: l.id, bidBps: l.bidBps ?? 120, askBps: l.askBps ?? 150 }))
  const lastRows = await db.select({ lpId: lpFills.lpId, lastAt: sql<Date>`max(${lpFills.createdAt})` }).from(lpFills).where(inArray(lpFills.lpId, configs.map((c) => c.id))).groupBy(lpFills.lpId)
  const last = new Map<string, number>(lastRows.map((r) => [r.lpId, r.lastAt ? new Date(r.lastAt).getTime() : 0]))
  const lpId = selectLPForSwap(configs, 'NTZS_TO_STABLE', last).id

  // Deliver USDC straight to the partner's destination address when given, else credit the float.
  const recipient = (s.destinationAddress && ethers.isAddress(s.destinationAddress)) ? s.destinationAddress : wallet.address

  await setStatus(settlementId, { status: 'swapping' })
  const signer = getSettlementSigner(partner.encryptedHdSeed, wallet.walletIndex)
  let swapInTxHash: string | undefined
  let swapOutTxHash: string | undefined
  try {
    for await (const u of executeSwap({
      userPrivateKey: signer.privateKey as `0x${string}`,
      solverPrivateKey,
      solverAddress,
      selectedLpId: lpId,
      fromToken: 'NTZS',
      toToken: 'USDC',
      amount: tzsAmount,
      minOutput: usdcAmount,
      recipientAddress: recipient as `0x${string}`,
      rpcUrl,
    })) {
      if (u.txHash && !swapInTxHash) swapInTxHash = u.txHash
      if (u.status === 'FILLED') swapOutTxHash = u.txHash ?? swapOutTxHash
      if (u.status === 'FAILED' || u.status === 'PARTIAL_FILL_EXHAUSTED') {
        await setStatus(settlementId, { status: 'failed', error: u.message ?? 'Swap failed', swapInTxHash })
        return { ok: false, status: 'failed', error: u.message ?? 'nTZS→USDC swap failed' }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Swap error'
    await setStatus(settlementId, { status: 'failed', error: msg, swapInTxHash })
    return { ok: false, status: 'failed', error: msg }
  }

  await setStatus(settlementId, {
    status: 'completed',
    swapInTxHash,
    swapOutTxHash,
    ...(recipient !== wallet.address ? { forwardTxHash: swapOutTxHash } : {}),
  })
  await queuePartnerWebhook(s.partnerId, 'ramp.settlement.completed', {
    settlementId, direction: 'onramp', usdcAmount, deliveredTo: recipient,
  })
  return { ok: true, status: 'completed' }
}
