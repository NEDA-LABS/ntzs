import { ethers } from 'ethers'
import { eq, inArray, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { lpFxPairs, lpAccounts, lpFills } from '@ntzs/db'
import { calcMinOutput, selectLPForSwap, SWAP_TOKENS, type LPConfig } from '@/lib/fx/swap'
import { estimateSpendFee } from '@/lib/psp/selcom-fees'
import { expectedPayoutFeeTzs } from '@/lib/psp'
import { BASE_RPC_URL } from '@/lib/env'

export const RAMP_QUOTE_TTL_MS = 60_000
/** Legacy flat PSP fee — fallback pricing only; wallet off-ramps now price on
 * the expected serving rail (expectedPayoutFeeTzs). */
export const PSP_FLAT_FEE_TZS = 1500
export const PLATFORM_FEE_PCT = 0.005 // 0.5% on the gross TZS (off-ramp)

/**
 * Our margin as a PERCENT (0.5 = 0.5%), matching `partners.fee_percent` and
 * DEFAULT_PLATFORM_FEE_PERCENT everywhere else in the codebase.
 *
 * ⚠ TWO UNITS, ONE CONCEPT. `PLATFORM_FEE_PCT` above is a FRACTION (0.005);
 * the partners table stores a PERCENT (0.5). They differ by 100×, which on a
 * money path is not a rounding difference — it is charging a partner a hundred
 * times too much or too little. Every conversion goes through
 * `rampPlatformFeeTzs` so there is exactly one place to get it wrong, and a
 * test pins the two representations to the same number.
 */
export const DEFAULT_RAMP_FEE_PERCENT = PLATFORM_FEE_PCT * 100

/**
 * Our margin on a ramp, in TZS.
 *
 * `feePercent` is a percent. Anything absent, non-finite or non-positive falls
 * back to the default — a partner row with no explicit price is priced at the
 * standard rate, never at zero. Ramp pricing previously ignored the partner
 * entirely, so this is the first point at which a negotiated rate has any
 * effect; partners on the default see byte-identical pricing.
 */
export function rampPlatformFeeTzs(grossTzs: number, feePercent?: number | null): number {
  const pct = Number(feePercent)
  const effective = Number.isFinite(pct) && pct > 0 ? pct : DEFAULT_RAMP_FEE_PERCENT
  return Math.ceil((grossTzs * effective) / 100)
}

export type RampDirection = 'offramp' | 'onramp'

/**
 * Dedicated gate for RAMP off-ramps that pay a Selcom Lipa till / bill —
 * INDEPENDENT of the domestic spend gate (SELCOM_SPEND_ENABLED, already live).
 * Cross-border crypto → TZ-merchant payment is a distinct regulatory surface;
 * this stays OFF until the Bank of Tanzania green-lights it, regardless of the
 * migration state or the domestic spend rails. Wallet off-ramps are unaffected.
 */
export function rampSpendEnabled(): boolean {
  return process.env.RAMP_SPEND_ENABLED === 'true'
}

/** Off-ramp terminal destination. 'wallet' (default) = mobile-money payout
 * (the Snippe/AzamPay rail, flat PSP fee). 'lipa'/'bill' = pay a Selcom
 * merchant till / biller from the reserve, priced on the Selcom tariff. */
export type RampOfframpDestination =
  | { kind: 'wallet' }
  | { kind: 'lipa'; payNumber: string; network?: string; recipientName?: string | null }
  | { kind: 'bill'; utilityCode: string; utilityRef: string; recipientName?: string | null }

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
 * Invert the off-ramp fee chain: the smallest integer gross G (TZS the swap
 * must yield) such that G − platformFee(G) − pspFee(G) ≥ targetNetTzs.
 *
 * Fees are integer step functions (tiered PSP fee, ceil'd platform pct), so
 * at a tier edge some nets are unreachable exactly; the sliver (net(G) −
 * target, at most one tier jump) stays in feeTzs rather than shorting or
 * overpaying the recipient — the recipient receives EXACTLY the target.
 * Returns null when no G is found within bounds (never loops forever).
 */
export function solveOfframpGrossTzs(targetNetTzs: number, feesFor: (gross: number) => number): number | null {
  const net = (g: number) => g - feesFor(g)
  // Fixed point first — lands within one fee-tier jump of the answer.
  let g = targetNetTzs + feesFor(targetNetTzs)
  for (let i = 0; i < 8; i++) g = targetNetTzs + feesFor(g)
  // Walk up to feasibility, then down to minimality. Within one fee tier the
  // net rises 1:1 with G, so both walks terminate at the nearest boundary.
  let guard = 10_000
  while (net(g) < targetNetTzs && guard-- > 0) g++
  if (net(g) < targetNetTzs) return null
  while (g > 1 && net(g - 1) >= targetNetTzs && guard-- > 0) g--
  return guard > 0 ? g : null
}

/**
 * The USDC to debit so the off-ramp swap yields at least `grossTzs`: inverts
 * the linear swap leg, rounding UP at USDC precision (6 dp), then
 * forward-verifies to absorb float dust. Surplus is sub-shilling and stays in
 * the settlement accounting.
 */
export function usdcForGrossTzs(grossTzs: number, midRate: number, bidBps: number, askBps: number): number {
  const swapOut = (u: number) => calcMinOutput({ fromToken: 'USDC', toToken: 'NTZS', amount: u, midRate, bidBps, askBps, slippageBps: 0 })
  let usdc = Math.ceil((grossTzs / swapOut(1)) * 1e6) / 1e6
  for (let i = 0; i < 3 && Math.floor(swapOut(usdc)) < grossTzs; i++) {
    usdc = Math.round(usdc * 1e6 + 1) / 1e6
  }
  return usdc
}

/**
 * Compute a ramp quote.
 * - off-ramp: pass EITHER `usdcAmount` (USDC to spend → recipient TZS net)
 *   OR `tzsAmount` (the exact net the recipient must receive → USDC to
 *   debit). Partners' users ask in local currency, so the TZS form is the
 *   one integrations should prefer.
 * - on-ramp:  caller passes `tzsAmount` (TZS collected from payer) → USDC delivered.
 */
export async function computeRampQuote(params: {
  direction: RampDirection
  usdcAmount?: number
  tzsAmount?: number
  /** Off-ramp only — the terminal destination. Defaults to wallet payout. */
  destination?: RampOfframpDestination
  /**
   * Partner's negotiated margin as a PERCENT (0.5 = 0.5%). Omit for the
   * standard rate — see rampPlatformFeeTzs.
   */
  feePercent?: number | null
}): Promise<RampQuote | { error: string }> {
  const { direction } = params
  const ps = await getPairAndSpread(direction)
  if (!ps) return { error: 'No active USDC/nTZS pair configured' }
  const { midRate, bidBps, askBps } = ps

  if (direction === 'offramp') {
    // PSP fee depends on the destination: mobile-money wallet = the EXPECTED
    // SERVING RAIL's charge (Selcom is tiered, not the legacy flat 1,500);
    // Selcom Lipa/bill = the Selcom tariff. Both estimated on gross (one tier
    // ≥ the net) — conservative, so the reserve is never short. The
    // settlement engine (offramp.ts) derives the SAME figure from the same
    // gross, so quote and execution cannot disagree within one env state.
    const dest = params.destination ?? { kind: 'wallet' as const }
    const pspFeeFor = (gross: number): number =>
      dest.kind === 'wallet'
        ? expectedPayoutFeeTzs(Math.floor(gross))
        : estimateSpendFee(dest.kind, Math.floor(gross), dest.kind === 'bill' ? dest.utilityCode : undefined)

    const hasUsdc = params.usdcAmount != null
    const hasTzs = params.tzsAmount != null
    if (hasUsdc && hasTzs) return { error: 'Provide exactly one of usdcAmount or tzsAmount for an off-ramp quote' }
    if (!hasUsdc && !hasTzs) return { error: 'Provide usdcAmount (USDC to spend) or tzsAmount (the net TZS the recipient must receive)' }

    if (hasTzs) {
      // TZS-denominated: the partner names the exact NET the recipient must
      // receive; we answer with the USDC their float will be debited. Their
      // users request payouts in local currency, not USDC.
      const target = Math.trunc(Number(params.tzsAmount))
      if (!Number.isFinite(target) || target < 5000) {
        return { error: 'tzsAmount must be an integer of at least 5,000 TZS (the net the recipient receives)' }
      }
      const gross = solveOfframpGrossTzs(target, (g) => rampPlatformFeeTzs(g, params.feePercent) + pspFeeFor(g))
      if (gross == null) return { error: 'Could not price that tzsAmount — quote by usdcAmount instead' }

      const usdcAmount = usdcForGrossTzs(gross, midRate, bidBps, askBps)

      const lowLiquidity = (await solverNtzsLiquidity()) < gross
      return {
        direction, usdcAmount, tzsAmount: target, feeTzs: gross - target,
        rateUsdTzs: +(gross / usdcAmount).toFixed(6),
        bidBps, askBps, lowLiquidity,
      }
    }

    const usdcAmount = Number(params.usdcAmount)
    if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) return { error: 'usdcAmount must be a positive number' }

    // USDC → nTZS (1 nTZS == 1 TZS). Gross TZS the swap yields.
    const grossTzs = calcMinOutput({ fromToken: 'USDC', toToken: 'NTZS', amount: usdcAmount, midRate, bidBps, askBps, slippageBps: 0 })
    const platformFee = rampPlatformFeeTzs(grossTzs, params.feePercent)
    const pspFee = pspFeeFor(grossTzs)

    const feeTzs = pspFee + platformFee
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
  const platformFee = rampPlatformFeeTzs(tzsAmount, params.feePercent)
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
