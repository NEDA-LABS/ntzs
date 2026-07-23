import { NextRequest } from 'next/server'
import { getSessionFromCookies } from '@/lib/fx/auth'
import { swapRateLimit } from '@/lib/rate-limit'
import { db } from '@/lib/fx/db'
import { lpAccounts, lpFxPairs, lpFills, lpPoolPositions } from '@ntzs/db'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { deriveWallet } from '@/lib/fx/lp-wallet'
import { executeSwap, calcMinOutput, rankLPsByRate, filterLPsByInventory, SWAP_TOKENS, type SwapTokenSymbol, type LPConfig, type SwapResult } from '@/lib/fx/swap'
import { BASE_RPC_URL, PLATFORM_FX_FEE_BPS } from '@/lib/env'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * POST /simplefx/api/lp/swap
 *
 * Direct pool test swap from the LP's own wallet (inactive LPs only).
 * Priced and ledgered exactly like /api/v1/swap: the fill is attributed to the
 * best active LP and the double-entry pool accounting runs, so test swaps can
 * never drift the ledger away from the solver's real on-chain holdings (the
 * 21 Jul incident: an unledgered test swap left an LP's USDC claim above the
 * pool balance, blocking their deactivation).
 * Streams SSE status updates.
 *
 * Body: { fromToken, toToken, amount, slippageBps? }
 */
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) return new Response('Unauthorized', { status: 401 })

  // This is a TEST tool: when the LP is active it signs with the solver
  // (shared pool) key, so leaving it openly callable lets any authenticated LP
  // move pooled funds. Disabled unless explicitly enabled for a test session.
  if (process.env.FX_TEST_SWAP_ENABLED !== 'true') {
    return new Response('Swap test endpoint is disabled', { status: 403 })
  }

  const limited = await swapRateLimit(`swap:lp:${session.lpId}`)
  if (limited) return limited

  const rpcUrl = BASE_RPC_URL
  const solverPrivateKey = process.env.SOLVER_PRIVATE_KEY as `0x${string}` | undefined
  const solverAddress = (process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646') as `0x${string}`
  if (!solverPrivateKey) {
    return new Response('SOLVER_PRIVATE_KEY not configured', { status: 503 })
  }

  let body: { fromToken: SwapTokenSymbol; toToken: SwapTokenSymbol; amount: number; slippageBps?: number }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { fromToken, toToken, amount, slippageBps = 100 } = body

  if (!fromToken || !toToken || fromToken === toToken || !amount || amount <= 0) {
    return new Response('fromToken, toToken (must differ), and amount are required', { status: 400 })
  }

  const [lp] = await db
    .select()
    .from(lpAccounts)
    .where(eq(lpAccounts.id, session.lpId))
    .limit(1)

  if (!lp) return new Response('LP account not found', { status: 404 })

  const pairs = await db.select().from(lpFxPairs).where(eq(lpFxPairs.isActive, true)).limit(10)
  const tokenAddr = (sym: SwapTokenSymbol) => SWAP_TOKENS[sym].address.toLowerCase()

  const pair = pairs.find(
    (p: typeof pairs[number]) =>
      (p.token1Address.toLowerCase() === tokenAddr(fromToken) || p.token2Address.toLowerCase() === tokenAddr(fromToken)) &&
      (p.token1Address.toLowerCase() === tokenAddr(toToken) || p.token2Address.toLowerCase() === tokenAddr(toToken))
  )

  if (!pair) return new Response('No active pair for these tokens', { status: 404 })

  const midRate = parseFloat(pair.midRate.toString())

  // Price and attribute exactly like /api/v1/swap: the pool's inventory belongs
  // to active LPs, so the best active LP by spread — not the tester — is the
  // counterparty that earns the spread and whose position the fill adjusts.
  const activeLPs = await db
    .select({ id: lpAccounts.id, bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
    .from(lpAccounts)
    .where(eq(lpAccounts.isActive, true as unknown as boolean))

  if (activeLPs.length === 0) {
    return new Response('No active liquidity provider to take the other side of the swap. Activate a pool LP first.', { status: 503 })
  }

  const direction = toToken === 'NTZS' ? 'STABLE_TO_NTZS' : 'NTZS_TO_STABLE'
  const lpConfigs: LPConfig[] = activeLPs.map((a) => ({ id: a.id, bidBps: a.bidBps ?? 120, askBps: a.askBps ?? 150 }))

  // Only LPs whose pooled out-token inventory covers the payout are eligible —
  // routing to a thin LP doesn't fail the swap, it silently drains other LPs'
  // pooled capital (the debit clamps at zero while the pool pays in full).
  const midOutput = fromToken === 'NTZS' ? amount / midRate : amount * midRate
  const outPositions = await db
    .select({ lpId: lpPoolPositions.lpId, contributed: lpPoolPositions.contributed })
    .from(lpPoolPositions)
    .where(and(
      eq(lpPoolPositions.chain, 'base'),
      eq(lpPoolPositions.tokenAddress, tokenAddr(toToken)),
      inArray(lpPoolPositions.lpId, lpConfigs.map((l) => l.id)),
    ))
  const inventoryByLpId = new Map(outPositions.map((p) => [p.lpId, parseFloat(p.contributed)]))
  const coveredLPs = filterLPsByInventory(lpConfigs, inventoryByLpId, midOutput)
  if (coveredLPs.length === 0) {
    return new Response('Insufficient LP inventory for this swap size. Try a smaller amount.', { status: 503 })
  }
  const bestLP = rankLPsByRate(coveredLPs, direction)[0]

  const minOutput = calcMinOutput({
    fromToken,
    toToken,
    amount,
    midRate,
    bidBps: bestLP.bidBps,
    askBps: bestLP.askBps,
    slippageBps,
    protocolFeeBps: PLATFORM_FX_FEE_BPS,
  })

  // Active LPs have no funds to test with: activation sweeps their wallet into
  // the shared pool, so the balance check below can never pass — and signing
  // with the pool key instead would let any active LP move pooled funds (the
  // hole this endpoint was originally gated off for). Taker swaps via
  // /api/v1/swap fill active LPs automatically; testing from this page requires
  // deactivating first so funds return to the LP's own wallet.
  if (lp.isActive) {
    return new Response(
      'Your capital is active in the shared pool, so there is nothing in your LP wallet to swap. Taker swaps fill you automatically — watch the Transactions page. To place a test swap from your own wallet, deactivate from the Rebalance page first.',
      { status: 409 }
    )
  }

  const { privateKey } = deriveWallet(lp.walletIndex)
  const signerKey: `0x${string}` = privateKey as `0x${string}`

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { /* client disconnected */ }
      }

      try {
        for await (const update of executeSwap({
          userPrivateKey: signerKey,
          solverPrivateKey: solverPrivateKey!,
          solverAddress,
          selectedLpId: bestLP.id,
          fromToken,
          toToken,
          amount,
          minOutput,
          recipientAddress: lp.walletAddress as `0x${string}`,
          rpcUrl,
        })) {
          const { _result, ...clientUpdate } = update as typeof update & { _result?: SwapResult }

          // Same double-entry recording as /api/v1/swap — a test swap moves the
          // same real tokens, so it must move the same ledger entries. Books
          // before broadcast: the fill is recorded before the client sees
          // FILLED, so a disconnect can't leave moved funds unledgered.
          if (update.status === 'FILLED' && _result) {
            const toMeta = SWAP_TOKENS[toToken]
            const fromMeta = SWAP_TOKENS[fromToken]
            const totalSpread = Math.max(0, midOutput - parseFloat(_result.amountOut))
            const protocolFee = Math.min(totalSpread, midOutput * PLATFORM_FX_FEE_BPS / 10000)
            const lpSpread = totalSpread - protocolFee

            try {
              await db.insert(lpFills).values({
                lpId: bestLP.id,
                userAddress: lp.walletAddress,
                fromToken: fromMeta.address,
                toToken: toMeta.address,
                amountIn: _result.amountIn,
                amountOut: _result.amountOut,
                spreadEarned: lpSpread.toFixed(toMeta.decimals),
                protocolFeeEarned: protocolFee.toFixed(toMeta.decimals),
                inTxHash: _result.inTxHash,
                outTxHash: _result.outTxHash,
                source: 'lp_test',
              })

              const feeStr = protocolFee.toFixed(toMeta.decimals)
              await db
                .update(lpPoolPositions)
                .set({
                  contributed: sql`GREATEST(0, ${lpPoolPositions.contributed} - ${_result.amountOut}::numeric - ${feeStr}::numeric)`,
                  updatedAt: new Date(),
                })
                .where(and(
                  eq(lpPoolPositions.lpId, bestLP.id),
                  eq(lpPoolPositions.chain, 'base'),
                  eq(lpPoolPositions.tokenAddress, toMeta.address.toLowerCase()),
                ))

              await db
                .insert(lpPoolPositions)
                .values({
                  lpId: bestLP.id,
                  chain: 'base',
                  tokenAddress: fromMeta.address.toLowerCase(),
                  tokenSymbol: fromToken,
                  decimals: fromMeta.decimals,
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
              console.error('[lp/swap] Failed to record fill:', err)
            }
          }

          send(clientUpdate)
          if (['FILLED', 'FAILED', 'PARTIAL_FILL_EXHAUSTED'].includes(update.status)) break
        }
      } catch (err) {
        send({ status: 'FAILED', message: err instanceof Error ? err.message : 'Swap error' })
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
