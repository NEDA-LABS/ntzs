import { ethers } from 'ethers'
import { eq, inArray, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { lpFxPairs, lpAccounts, lpFills } from '@ntzs/db'
import { calcMinOutput, selectLPForSwap, SWAP_TOKENS, type LPConfig } from '@/lib/fx/swap'
import { BASE_RPC_URL } from '@/lib/env'

export const RAMP_QUOTE_TTL_MS = 60_000
export const PSP_FLAT_FEE_TZS = 1500
export const PLATFORM_FEE_PCT = 0.005 // 0.5% on the gross TZS (off-ramp)

export type RampDirection = 'offramp' | 'onramp'

export interface RampQuote {
  direction: RampDirection
  usdcAmount: number
  tzsAmount: number    // off-ramp: recipient net; on-ramp: TZS collected
  feeTzs: number
  rateUsdTzs: number   // effective TZS per 1 USDC
  bidBps: number
  askBps: number
  lowLiquidity: boolean
}

const USDC = SWAP_TOKENS.USDC.address.toLowerCase()
const NTZS = SWAP_TOKENS.NTZS.address.toLowerCase()

/** Resolve the active USDC/nTZS pair mid-rate + the best LP spread (mirrors /api/v1/swap/rate). */
async function getPairAndSpread(direction: RampDirection): Promise<{ midRate: number; bidBps: number; askBps: number } | null> {
  const { db } = getDb()

  const pairs = await db.select().from(lpFxPairs).where(eq(lpFxPairs.isActive, true)).limit(10)
  const pair = pairs.find((p) => {
    const t1 = p.token1Address.toLowerCase(), t2 = p.token2Address.toLowerCase()
    return (p.chain ?? 'base') === 'base' && (t1 === USDC || t2 === USDC) && (t1 === NTZS || t2 === NTZS)
  })
  if (!pair) return null

  const midRate = parseFloat(pair.midRate.toString())

  const activeLPs = await db
    .select({ id: lpAccounts.id, bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
    .from(lpAccounts)
    .where(eq(lpAccounts.isActive, true))

  let bidBps = 120, askBps = 150
  if (activeLPs.length > 0) {
    const configs: LPConfig[] = activeLPs.map((lp) => ({ id: lp.id, bidBps: lp.bidBps ?? 120, askBps: lp.askBps ?? 150 }))
    const lastFillRows = await db
      .select({ lpId: lpFills.lpId, lastAt: sql<Date>`max(${lpFills.createdAt})` })
      .from(lpFills)
      .where(inArray(lpFills.lpId, configs.map((c) => c.id)))
      .groupBy(lpFills.lpId)
    const lastFills = new Map<string, number>(lastFillRows.map((r) => [r.lpId, r.lastAt ? new Date(r.lastAt).getTime() : 0]))
    // off-ramp uses USDC→nTZS (ask side); on-ramp uses nTZS→USDC (bid side)
    const best = selectLPForSwap(configs, direction === 'offramp' ? 'STABLE_TO_NTZS' : 'NTZS_TO_STABLE', lastFills)
    bidBps = best.bidBps
    askBps = best.askBps
  }

  return { midRate, bidBps, askBps }
}

async function solverNtzsLiquidity(): Promise<number> {
  const solver = process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646'
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const c = new ethers.Contract(SWAP_TOKENS.NTZS.address, ['function balanceOf(address) view returns (uint256)'], provider)
    return parseFloat(ethers.formatUnits(await c.balanceOf(solver), SWAP_TOKENS.NTZS.decimals))
  } catch { return Infinity }
}

async function solverUsdcLiquidity(): Promise<number> {
  const solver = process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646'
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const c = new ethers.Contract(SWAP_TOKENS.USDC.address, ['function balanceOf(address) view returns (uint256)'], provider)
    return parseFloat(ethers.formatUnits(await c.balanceOf(solver), SWAP_TOKENS.USDC.decimals))
  } catch { return Infinity }
}

/**
 * Compute a ramp quote.
 * - off-ramp: caller passes `usdcAmount` (USDC they'll spend) → recipient TZS net.
 * - on-ramp:  caller passes `tzsAmount` (TZS collected from payer) → USDC delivered.
 */
export async function computeRampQuote(params: {
  direction: RampDirection
  usdcAmount?: number
  tzsAmount?: number
}): Promise<RampQuote | { error: string }> {
  const { direction } = params
  const ps = await getPairAndSpread(direction)
  if (!ps) return { error: 'No active USDC/nTZS pair configured' }
  const { midRate, bidBps, askBps } = ps

  if (direction === 'offramp') {
    const usdcAmount = Number(params.usdcAmount)
    if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) return { error: 'usdcAmount must be a positive number' }

    // USDC → nTZS (1 nTZS == 1 TZS). Gross TZS the swap yields.
    const grossTzs = calcMinOutput({ fromToken: 'USDC', toToken: 'NTZS', amount: usdcAmount, midRate, bidBps, askBps, slippageBps: 0 })
    const platformFee = Math.ceil(grossTzs * PLATFORM_FEE_PCT)
    const feeTzs = PSP_FLAT_FEE_TZS + platformFee
    const tzsAmount = Math.floor(grossTzs) - feeTzs
    if (tzsAmount < 5000) return { error: 'Amount too small — recipient would net under 5,000 TZS after fees' }

    const lowLiquidity = (await solverNtzsLiquidity()) < grossTzs
    return {
      direction, usdcAmount, tzsAmount, feeTzs,
      rateUsdTzs: +(grossTzs / usdcAmount).toFixed(6),
      bidBps, askBps, lowLiquidity,
    }
  }

  // on-ramp: TZS in → USDC out
  const tzsAmount = Math.trunc(Number(params.tzsAmount))
  if (!Number.isFinite(tzsAmount) || tzsAmount < 5000) return { error: 'tzsAmount must be at least 5,000 TZS' }

  // Platform fee skimmed in nTZS after the swap; the customer pays tzsAmount and
  // receives USDC for the net. Mirrors the off-ramp's PLATFORM_FEE_PCT.
  const platformFee = Math.ceil(tzsAmount * PLATFORM_FEE_PCT)
  const netTzs = tzsAmount - platformFee

  // nTZS (== TZS minted) → USDC, on the net after the platform fee.
  const usdcAmount = calcMinOutput({ fromToken: 'NTZS', toToken: 'USDC', amount: netTzs, midRate, bidBps, askBps, slippageBps: 0 })
  if (usdcAmount <= 0) return { error: 'Amount too small to deliver any USDC' }

  const lowLiquidity = (await solverUsdcLiquidity()) < usdcAmount
  return {
    direction, usdcAmount: +usdcAmount.toFixed(6), tzsAmount, feeTzs: platformFee,
    rateUsdTzs: +(tzsAmount / usdcAmount).toFixed(6),
    bidBps, askBps, lowLiquidity,
  }
}
