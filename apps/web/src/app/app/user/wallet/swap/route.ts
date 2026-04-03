import { NextRequest } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'

import { requireAnyRole } from '@/lib/auth/rbac'
import { deriveWallet } from '@/lib/waas/hd-wallets'
import { getDb } from '@/lib/db'
import { wallets, lpFxPairs, lpAccounts, lpPoolPositions, lpFills } from '@ntzs/db'
import { executeSwap, calcMinOutput, SWAP_TOKENS, type SwapTokenSymbol } from '@/lib/fx/swap'

export const runtime = 'nodejs'
export const maxDuration = 300

const SOLVER_ADDRESS = (process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646') as `0x${string}`

export async function POST(request: NextRequest) {
  let dbUser: Awaited<ReturnType<typeof requireAnyRole>>
  try {
    dbUser = await requireAnyRole(['end_user', 'super_admin'])
  } catch {
    return new Response('Unauthorized', { status: 401 })
  }

  const { db } = getDb()

  const [wallet] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, dbUser.id), eq(wallets.provider, 'platform_hd')))
    .limit(1)

  if (!wallet) return new Response('No swap-eligible wallet found for this account', { status: 404 })
  if (wallet.providerWalletRef === null) return new Response('Wallet index not provisioned', { status: 404 })

  const platformSeed = process.env.PLATFORM_HD_SEED
  const solverPrivateKey = process.env.SOLVER_PRIVATE_KEY as `0x${string}` | undefined
  const rpcUrl = process.env.BASE_RPC_URL

  if (!platformSeed || !solverPrivateKey || !rpcUrl) {
    return new Response('Server configuration error', { status: 503 })
  }

  const walletIndex = parseInt(wallet.providerWalletRef ?? '0', 10)
  const hdWallet = deriveWallet(platformSeed, walletIndex)
  const userPrivateKey = hdWallet.privateKey as `0x${string}`
  const recipientAddress = hdWallet.address as `0x${string}`

  let body: { fromToken: SwapTokenSymbol; toToken: SwapTokenSymbol; amount: number; slippageBps?: number }
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { fromToken, toToken, amount, slippageBps = 100 } = body
  if (!fromToken || !toToken || fromToken === toToken || !amount || amount <= 0) {
    return new Response('fromToken, toToken (must differ), and amount are required', { status: 400 })
  }
  if (!SWAP_TOKENS[fromToken] || !SWAP_TOKENS[toToken]) {
    return new Response('Unsupported tokens. Valid: NTZS, USDC', { status: 400 })
  }

  const pairs = await db.select().from(lpFxPairs).where(eq(lpFxPairs.isActive, true)).limit(10)
  const NTZS_ADDR = SWAP_TOKENS.NTZS.address.toLowerCase()
  const USDC_ADDR = SWAP_TOKENS.USDC.address.toLowerCase()
  const tokenAddr = (sym: SwapTokenSymbol) => (sym === 'NTZS' ? NTZS_ADDR : USDC_ADDR)

  const pair = pairs.find(
    (p) =>
      (p.token1Address.toLowerCase() === tokenAddr(fromToken) || p.token2Address.toLowerCase() === tokenAddr(fromToken)) &&
      (p.token1Address.toLowerCase() === tokenAddr(toToken) || p.token2Address.toLowerCase() === tokenAddr(toToken))
  )
  if (!pair) return new Response('No active trading pair found', { status: 404 })

  const midRate = parseFloat(pair.midRate.toString())
  const [lp] = await db
    .select({ id: lpAccounts.id, bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
    .from(lpAccounts)
    .where(eq(lpAccounts.isActive, true as unknown as boolean))
    .limit(1)

  if (!lp) return new Response('No active liquidity provider', { status: 503 })

  const bidBps = lp.bidBps ?? 120
  const askBps = lp.askBps ?? 150
  const minOutput = calcMinOutput({ fromToken, toToken, amount, midRate, bidBps, askBps, slippageBps })

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
          userPrivateKey,
          solverPrivateKey,
          solverAddress: SOLVER_ADDRESS,
          fromToken,
          toToken,
          amount,
          minOutput,
          recipientAddress,
          rpcUrl,
        })) {
          const { _result, ...clientUpdate } = update as typeof update & { _result?: { inTxHash: string; outTxHash: string; amountIn: string; amountOut: string } }
          send(clientUpdate)

          // On success, record the fill and credit LP earnings
          if (update.status === 'FILLED' && _result) {
            const fromDecimals = SWAP_TOKENS[fromToken].decimals
            const toDecimals = SWAP_TOKENS[toToken].decimals

            // Spread earned = difference between mid-rate output and actual output paid
            const midOutput = fromToken === 'NTZS'
              ? amount / midRate
              : amount * midRate
            const spread = Math.max(0, midOutput - parseFloat(_result.amountOut))

            try {
              await db.insert(lpFills).values({
                lpId: lp.id,
                userAddress: recipientAddress,
                fromToken: SWAP_TOKENS[fromToken].address,
                toToken: SWAP_TOKENS[toToken].address,
                amountIn: _result.amountIn,
                amountOut: _result.amountOut,
                spreadEarned: spread.toFixed(toDecimals),
                inTxHash: _result.inTxHash,
                outTxHash: _result.outTxHash,
              })

              // Credit earned spread to LP pool position for the output token
              const outTokenAddr = SWAP_TOKENS[toToken].address.toLowerCase()
              await db
                .update(lpPoolPositions)
                .set({
                  earned: sql`${lpPoolPositions.earned} + ${spread.toFixed(toDecimals)}::numeric`,
                  updatedAt: new Date(),
                })
                .where(and(
                  eq(lpPoolPositions.lpId, lp.id),
                  eq(lpPoolPositions.tokenAddress, outTokenAddr),
                ))

              // Also update contributed to reflect new pool balance (in += amountIn, out -= amountOut)
              const inTokenAddr = SWAP_TOKENS[fromToken].address.toLowerCase()
              await db
                .update(lpPoolPositions)
                .set({
                  contributed: sql`${lpPoolPositions.contributed} + ${_result.amountIn}::numeric`,
                  updatedAt: new Date(),
                })
                .where(and(
                  eq(lpPoolPositions.lpId, lp.id),
                  eq(lpPoolPositions.tokenAddress, inTokenAddr),
                ))

              void fromDecimals // used above
            } catch (err) {
              console.error('[swap] Failed to record fill:', err)
            }
          }

          if (['FILLED', 'FAILED'].includes(update.status)) break
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
