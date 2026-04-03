import { NextRequest } from 'next/server'
import { getSessionFromCookies } from '@/lib/fx/auth'
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
  const NTZS_ADDR = SWAP_TOKENS.NTZS.address.toLowerCase()
  const USDC_ADDR = SWAP_TOKENS.USDC.address.toLowerCase()
  const tokenAddr = (sym: SwapTokenSymbol) => (sym === 'NTZS' ? NTZS_ADDR : USDC_ADDR)

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

  // When LP is active, tokens are in the solver wallet (swept on activation).
  // Use solver wallet to place the test order so it has the balance to escrow.
  // When inactive, LP wallet still holds the tokens.
  let signerKey: `0x${string}`

  if (lp.isActive) {
    const solverKey = process.env.SOLVER_PRIVATE_KEY
    if (!solverKey) return new Response('SOLVER_PRIVATE_KEY not configured', { status: 503 })
    signerKey = solverKey as `0x${string}`
  } else {
    const { privateKey } = deriveWallet(lp.walletIndex)
    signerKey = privateKey as `0x${string}`
  }

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
