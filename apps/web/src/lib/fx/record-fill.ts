import { and, eq, sql } from 'drizzle-orm'

import { lpFills, lpPoolPositions } from '@ntzs/db'
import { PLATFORM_FX_FEE_BPS } from '@/lib/env'

type Db = ReturnType<typeof import('@/lib/db').getDb>['db']

/**
 * The spread split every fill uses: the LP's edge over mid, with the protocol
 * fee carved from the LP's side — the taker's rate is unchanged. Pure, so the
 * split is unit-testable away from the DB.
 */
export function splitSpread(midOutput: number, amountOut: number, feeBps: number = PLATFORM_FX_FEE_BPS): { totalSpread: number; protocolFee: number; lpSpread: number } {
  const totalSpread = Math.max(0, midOutput - amountOut)
  const protocolFee = Math.min(totalSpread, (midOutput * feeBps) / 10000)
  return { totalSpread, protocolFee, lpSpread: totalSpread - protocolFee }
}

export interface RecordLpFillArgs {
  lpId: string
  /** The taker — for ramp settlements, the partner's settlement wallet. */
  userAddress: string
  fromToken: { address: string; decimals: number; symbol: string }
  toToken: { address: string; decimals: number; symbol: string }
  fromChain: 'base' | 'bnb' | 'eth'
  toChain: 'base' | 'bnb' | 'eth'
  amountIn: string
  amountOut: string
  inTxHash: string
  outTxHash: string
  /** Mid-rate output for the swapped amount — prices the spread. Pass
   * amountOut when the mid is unknown (records the fill with zero spread
   * rather than guessing). */
  midOutput: number
  source: string
  partnerId?: string | null
}

/**
 * Record an executed LP fill: the lp_fills row plus the DOUBLE-ENTRY pool
 * position updates. Semantics are copied verbatim from the swap routes
 * (v1/swap is canonical): the solver RECEIVED amountIn of the in-token and
 * PAID OUT amountOut of the out-token, retaining protocolFee (out-token
 * denominated) until the fee sweep — so debit the FULL outflow
 * (amountOut + protocolFee) and upsert-credit the inflow. The LP's profit is
 * implicit in the amounts; a separate `earned` credit would double-count
 * (the single-entry bug that once inflated positions above solver balance).
 *
 * Every path that moves solver inventory through executeSwap MUST call this —
 * the ramp settlement engine didn't, and its first live swap (3 Aug 2026)
 * fired the pool reconciler on both detectors: unmatched transfers (no fill
 * row shared the tx hashes) and a solver-balance deficit (positions never
 * debited). Recording the fill is the fix; the reconciler needs no exceptions.
 */
export async function recordLpFill(db: Db, args: RecordLpFillArgs): Promise<{ protocolFee: number; lpSpread: number }> {
  const toDecimals = args.toToken.decimals
  const { protocolFee, lpSpread } = splitSpread(args.midOutput, parseFloat(args.amountOut))

  await db.insert(lpFills).values({
    lpId: args.lpId,
    userAddress: args.userAddress,
    fromToken: args.fromToken.address,
    toToken: args.toToken.address,
    amountIn: args.amountIn,
    amountOut: args.amountOut,
    spreadEarned: lpSpread.toFixed(toDecimals),
    protocolFeeEarned: protocolFee.toFixed(toDecimals),
    inTxHash: args.inTxHash,
    outTxHash: args.outTxHash,
    source: args.source,
    ...(args.partnerId ? { partnerId: args.partnerId } : {}),
  })

  const outTokenAddr = args.toToken.address.toLowerCase()
  const feeStr = protocolFee.toFixed(toDecimals)
  await db
    .update(lpPoolPositions)
    .set({
      // GREATEST(0, …) guards against rounding dust pushing it negative.
      contributed: sql`GREATEST(0, ${lpPoolPositions.contributed} - ${args.amountOut}::numeric - ${feeStr}::numeric)`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(lpPoolPositions.lpId, args.lpId),
      eq(lpPoolPositions.chain, args.toChain),
      eq(lpPoolPositions.tokenAddress, outTokenAddr),
    ))

  // Credit the in-token inflow. UPSERT: the LP may not hold a row for this
  // token yet, in which case a plain UPDATE would silently lose the received
  // funds from the ledger.
  const inTokenAddr = args.fromToken.address.toLowerCase()
  await db
    .insert(lpPoolPositions)
    .values({
      lpId: args.lpId,
      chain: args.fromChain,
      tokenAddress: inTokenAddr,
      tokenSymbol: args.fromToken.symbol,
      decimals: args.fromToken.decimals,
      contributed: args.amountIn,
      earned: '0',
    })
    .onConflictDoUpdate({
      target: [lpPoolPositions.lpId, lpPoolPositions.chain, lpPoolPositions.tokenAddress],
      set: {
        contributed: sql`${lpPoolPositions.contributed} + ${args.amountIn}::numeric`,
        updatedAt: new Date(),
      },
    })

  return { protocolFee, lpSpread }
}
