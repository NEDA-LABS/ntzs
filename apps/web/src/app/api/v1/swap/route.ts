import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import { swapRateLimit } from '@/lib/rate-limit'
import { deriveWallet } from '@/lib/waas/hd-wallets'
import { partnerUsers, partners, lpFxPairs, lpAccounts, lpFills, lpPoolPositions } from '@ntzs/db'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { executeSwap, calcMinOutput, rankLPsByRate, filterLPsByInventory, SWAP_TOKENS, type SwapTokenSymbol, type LPConfig, type SwapResult } from '@/lib/fx/swap'
import { getChainConfig, getChainToken, type ChainId } from '@/lib/fx/chainConfig'
import { PLATFORM_FX_FEE_BPS } from '@/lib/env'

export const runtime = 'nodejs'
export const maxDuration = 300


/**
 * POST /api/v1/swap
 *
 * Places a direct LP pool swap on Base mainnet on behalf of a WaaS user.
 * Streams Server-Sent Events (SSE) with real-time order status updates.
 *
 * Body: { userId, fromToken: 'USDC'|'NTZS', toToken: 'NTZS'|'USDC', amount, slippageBps? }
 * Auth: Bearer <partner-api-key>
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const { partner } = authResult

  const limited = await swapRateLimit(`swap:partner:${partner.id}`)
  if (limited) return limited

  let body: {
    userId: string
    fromToken: SwapTokenSymbol
    toToken: SwapTokenSymbol
    fromChain?: ChainId
    toChain?: ChainId
    amount: number
    slippageBps?: number
  }

  try {
    body = await request.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const { userId, fromToken, toToken, fromChain = 'base', toChain = 'base', amount, slippageBps = 100 } = body

  if (!userId || !fromToken || !toToken || !amount) {
    return new Response('userId, fromToken, toToken, and amount are required', { status: 400 })
  }
  if (fromToken === toToken) {
    return new Response('fromToken and toToken must differ', { status: 400 })
  }
  if (!SWAP_TOKENS[fromToken] || !SWAP_TOKENS[toToken]) {
    return new Response(`Unsupported tokens. Valid: ${Object.keys(SWAP_TOKENS).join(', ')}`, { status: 400 })
  }

  const { db } = getDb()

  // Resolve the user's wallet index + partner seed
  const [pu] = await db
    .select({ walletIndex: partnerUsers.walletIndex })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, userId)))
    .limit(1)

  if (!pu) return new Response('User not found', { status: 404 })
  if (pu.walletIndex === null) return new Response('User wallet not provisioned', { status: 404 })

  const [partnerRow] = await db
    .select({ encryptedHdSeed: partners.encryptedHdSeed })
    .from(partners)
    .where(eq(partners.id, partner.id))
    .limit(1)

  if (!partnerRow?.encryptedHdSeed) return new Response('Partner seed not configured', { status: 503 })

  const hdWallet = deriveWallet(partnerRow.encryptedHdSeed, pu.walletIndex)
  const privateKey = hdWallet.privateKey as `0x${string}`
  const recipientAddress = hdWallet.address as `0x${string}`

  // Resolve chain configs for this swap
  let fromCfg: ReturnType<typeof getChainConfig>, toCfg: ReturnType<typeof getChainConfig>
  try {
    fromCfg = getChainConfig(fromChain)
    toCfg   = getChainConfig(toChain)
  } catch (e) {
    return new Response((e as Error).message, { status: 503 })
  }

  if (!toCfg.solverPrivateKey) {
    return new Response('Swap service not available', { status: 503 })
  }

  // Resolve token addresses from the correct chain
  let fromTokenAddress: string, toTokenAddress: string
  try {
    fromTokenAddress = getChainToken(fromChain, fromToken).address.toLowerCase()
    toTokenAddress   = getChainToken(toChain, toToken).address.toLowerCase()
  } catch {
    // Fall back to Base SWAP_TOKENS for backward compat
    fromTokenAddress = SWAP_TOKENS[fromToken]?.address.toLowerCase() ?? ''
    toTokenAddress   = SWAP_TOKENS[toToken]?.address.toLowerCase() ?? ''
  }

  // For cross-chain pairs the "stablecoin chain" is whichever side isn't NTZS
  const stablecoinChain = fromToken === 'NTZS' ? toChain : fromChain
  const pairs = await db.select().from(lpFxPairs).where(eq(lpFxPairs.isActive, true)).limit(20)

  const pair = pairs.find((p: typeof pairs[number]) => {
    const p1 = p.token1Address.toLowerCase()
    const p2 = p.token2Address.toLowerCase()
    const matchesTokens = (
      (p1 === fromTokenAddress || p2 === fromTokenAddress) &&
      (p1 === toTokenAddress   || p2 === toTokenAddress)
    )
    // For cross-chain, also match by stablecoin chain
    const matchesChain = fromChain === toChain ? p.chain === fromChain : p.chain === stablecoinChain
    return matchesTokens && matchesChain
  })

  if (!pair) {
    return new Response('No active trading pair found for these tokens', { status: 404 })
  }

  const midRate = parseFloat(pair.midRate.toString())

  // Pick best LP rate for this direction
  const activeLPs = await db
    .select({ id: lpAccounts.id, bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
    .from(lpAccounts)
    .where(eq(lpAccounts.isActive, true as unknown as boolean))

  if (activeLPs.length === 0) {
    return new Response('No active liquidity provider', { status: 503 })
  }

  const direction = toToken === 'NTZS' ? 'STABLE_TO_NTZS' : 'NTZS_TO_STABLE'
  const lpConfigs: LPConfig[] = activeLPs.map((lp) => ({
    id: lp.id,
    bidBps: lp.bidBps ?? 120,
    askBps: lp.askBps ?? 150,
  }))

  // Only LPs whose pooled out-token inventory covers the payout are eligible —
  // routing to a thin LP doesn't fail the swap, it silently drains other LPs'
  // pooled capital (the debit clamps at zero while the pool pays in full).
  const midOutput = fromToken === 'NTZS' ? amount / midRate : amount * midRate
  const outPositions = await db
    .select({ lpId: lpPoolPositions.lpId, contributed: lpPoolPositions.contributed })
    .from(lpPoolPositions)
    .where(and(
      eq(lpPoolPositions.chain, toChain),
      eq(lpPoolPositions.tokenAddress, toTokenAddress),
      inArray(lpPoolPositions.lpId, lpConfigs.map((lp) => lp.id)),
    ))
  const inventoryByLpId = new Map(outPositions.map((p) => [p.lpId, parseFloat(p.contributed)]))
  const coveredLPs = filterLPsByInventory(lpConfigs, inventoryByLpId, midOutput)
  if (coveredLPs.length === 0) {
    return new Response('Insufficient LP inventory for this swap size. Try a smaller amount.', { status: 503 })
  }
  const bestLP = rankLPsByRate(coveredLPs, direction)[0]

  // Protocol fee is charged on top of the LP spread: the taker's output is cut
  // by PLATFORM_FX_FEE_BPS, the LP keeps its full spread, and the fee accrues as
  // surplus in the solver pool. The fill-recording below derives the split from
  // (midOutput − amountOut), so reducing minOutput here is the only change needed.
  const minOutput = calcMinOutput({
    fromToken, toToken, amount, midRate,
    bidBps: bestLP.bidBps, askBps: bestLP.askBps, slippageBps,
    protocolFeeBps: PLATFORM_FX_FEE_BPS,
  })

  // Stream SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // client disconnected
        }
      }

      try {
        const isCrossChain = fromChain !== toChain
        for await (const update of executeSwap({
          userPrivateKey: privateKey,
          solverPrivateKey: toCfg.solverPrivateKey,
          solverAddress: toCfg.solverAddress,
          selectedLpId: bestLP.id,
          fromToken,
          toToken,
          fromChain,
          toChain,
          rpcUrl: toCfg.rpcUrl,
          ...(isCrossChain && {
            fromRpcUrl: fromCfg.rpcUrl,
            fromSolverAddress: fromCfg.solverAddress,
          }),
          amount,
          minOutput,
          recipientAddress,
        })) {
          const { _result, ...clientUpdate } = update as typeof update & { _result?: SwapResult }

          // Books before broadcast: record the fill BEFORE the client sees
          // FILLED, so a disconnecting client can't leave moved funds
          // unledgered if the runtime reclaims the function early.
          if (update.status === 'FILLED' && _result) {
            let toTokenMeta: { decimals: number; address: string }
            try {
              toTokenMeta = getChainToken(toChain, toToken)
            } catch {
              toTokenMeta = SWAP_TOKENS[toToken]
            }
            let fromTokenMeta: { decimals: number; address: string }
            try {
              fromTokenMeta = getChainToken(fromChain, fromToken)
            } catch {
              fromTokenMeta = SWAP_TOKENS[fromToken]
            }
            const toDecimals = toTokenMeta.decimals

            const totalSpread = Math.max(0, midOutput - parseFloat(_result.amountOut))
            // Protocol fee is carved from the LP's spread; user-facing rate is unchanged.
            const protocolFee = Math.min(totalSpread, midOutput * PLATFORM_FX_FEE_BPS / 10000)
            const lpSpread = totalSpread - protocolFee

            try {
              await db.insert(lpFills).values({
                lpId: bestLP.id,
                userAddress: recipientAddress,
                fromToken: fromTokenMeta.address,
                toToken: toTokenMeta.address,
                amountIn: _result.amountIn,
                amountOut: _result.amountOut,
                spreadEarned: lpSpread.toFixed(toDecimals),
                protocolFeeEarned: protocolFee.toFixed(toDecimals),
                inTxHash: _result.inTxHash,
                outTxHash: _result.outTxHash,
                source: 'waas',
                partnerId: partner.id,
              })

              // Double-entry pool accounting. The solver RECEIVED amountIn of the
              // in-token and PAID OUT amountOut of the out-token; it also retains
              // protocolFee (denominated in the out-token) until the fee-sweep moves
              // it to treasury. Debit the FULL outflow (amountOut + protocolFee) from
              // the out-token and credit the inflow to the in-token, so the recorded
              // position always tracks the solver's real, fee-net holdings. The LP's
              // profit (lpSpread) is captured implicitly — amountIn is worth more than
              // amountOut + fee — so no separate `earned` credit is needed (that was
              // the single-entry bug that inflated positions above solver balance).
              // Tripwire: selection filtered to covered LPs, so this firing
              // means the inventory read raced or the filter regressed.
              const debitTotal = parseFloat(_result.amountOut) + protocolFee
              const preInventory = inventoryByLpId.get(bestLP.id) ?? 0
              if (preInventory < debitTotal) {
                console.error('[waas/swap] INVARIANT BREACH: debit exceeds LP inventory', {
                  lpId: bestLP.id, debitTotal, preInventory, toToken,
                })
              }

              const outTokenAddr = toTokenMeta.address.toLowerCase()
              const feeStr = protocolFee.toFixed(toDecimals)
              await db
                .update(lpPoolPositions)
                .set({
                  // GREATEST(0, …) guards against rounding dust pushing it negative.
                  contributed: sql`GREATEST(0, ${lpPoolPositions.contributed} - ${_result.amountOut}::numeric - ${feeStr}::numeric)`,
                  updatedAt: new Date(),
                })
                .where(and(
                  eq(lpPoolPositions.lpId, bestLP.id),
                  eq(lpPoolPositions.chain, toChain),
                  eq(lpPoolPositions.tokenAddress, outTokenAddr),
                ))

              // Credit the in-token inflow. UPSERT: the LP may not hold a row for this
              // token yet (e.g. it was fully returned on a prior deactivate/off-ramp),
              // in which case a plain UPDATE would match nothing and silently lose the
              // received funds from the ledger.
              const inTokenAddr = fromTokenMeta.address.toLowerCase()
              await db
                .insert(lpPoolPositions)
                .values({
                  lpId: bestLP.id,
                  chain: fromChain,
                  tokenAddress: inTokenAddr,
                  tokenSymbol: fromToken,
                  decimals: fromTokenMeta.decimals,
                  contributed: _result.amountIn,
                  earned: '0',
                })
                .onConflictDoUpdate({
                  target: [lpPoolPositions.lpId, lpPoolPositions.chain, lpPoolPositions.tokenAddress],
                  set: {
                    contributed: sql`${lpPoolPositions.contributed} + ${_result.amountIn}::numeric`,
                    updatedAt: new Date(),
                  },
                })
            } catch (err) {
              console.error('[waas/swap] Failed to record fill:', err)
            }
          }

          send(clientUpdate)
          if (['FILLED', 'FAILED', 'PARTIAL_FILL_EXHAUSTED'].includes(update.status)) break
        }
      } catch (err) {
        send({
          status: 'FAILED',
          message: 'Swap error',
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
