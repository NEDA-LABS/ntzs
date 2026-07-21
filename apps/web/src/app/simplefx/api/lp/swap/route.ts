import { NextRequest } from 'next/server'
import { getSessionFromCookies } from '@/lib/fx/auth'
import { swapRateLimit } from '@/lib/rate-limit'
import { db } from '@/lib/fx/db'
import { lpAccounts, lpFxPairs } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { deriveWallet } from '@/lib/fx/lp-wallet'
import { executeSwap, calcMinOutput, SWAP_TOKENS, type SwapTokenSymbol } from '@/lib/fx/swap'
import { BASE_RPC_URL } from '@/lib/env'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * POST /simplefx/api/lp/swap
 *
 * Places a HyperBridge intent order from the LP's own wallet.
 * Used for testing the swap flow from the SimpleFX portal.
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
  const minOutput = calcMinOutput({
    fromToken,
    toToken,
    amount,
    midRate,
    bidBps: lp.bidBps,
    askBps: lp.askBps,
    slippageBps,
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
          selectedLpId: lp.id,
          fromToken,
          toToken,
          amount,
          minOutput,
          recipientAddress: lp.walletAddress as `0x${string}`,
          rpcUrl,
        })) {
          send(update)
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
