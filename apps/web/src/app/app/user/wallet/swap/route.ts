import { NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { requireAnyRole } from '@/lib/auth/rbac'
import { deriveWallet } from '@/lib/waas/hd-wallets'
import { getDb } from '@/lib/db'
import { wallets, lpFxPairs, lpAccounts } from '@ntzs/db'
import { executeSwap, calcMinOutput, SWAP_TOKENS, type SwapTokenSymbol } from '@/lib/fx/swap'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  let dbUser: Awaited<ReturnType<typeof requireAnyRole>>
  try {
    dbUser = await requireAnyRole(['end_user', 'super_admin'])
  } catch {
    return new Response('Unauthorized', { status: 401 })
  }

  const { db } = getDb()

  // Always use the platform_hd wallet for signing — it's the only wallet type
  // the server can sign for. Embedded/external wallets require client-side signing.
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, dbUser.id), eq(wallets.provider, 'platform_hd')))
    .limit(1)

  if (!wallet) return new Response('No swap-eligible wallet found for this account', { status: 404 })
  if (wallet.providerWalletRef === null) return new Response('Wallet index not provisioned', { status: 404 })

  const platformSeed = process.env.PLATFORM_HD_SEED
  const rpcUrl = process.env.BASE_RPC_URL
  const bundlerUrl = process.env.BUNDLER_URL
  if (!platformSeed || !rpcUrl || !bundlerUrl) {
    return new Response('Server configuration error', { status: 503 })
  }

  const walletIndex = parseInt(wallet.providerWalletRef ?? '0', 10)
  const hdWallet = deriveWallet(platformSeed, walletIndex)
  const privateKey = hdWallet.privateKey as `0x${string}`
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
    .select({ bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
    .from(lpAccounts)
    .where(eq(lpAccounts.isActive, true as unknown as boolean))
    .limit(1)

  const bidBps = lp?.bidBps ?? 120
  const askBps = lp?.askBps ?? 150
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
          privateKey,
          fromToken,
          toToken,
          amount,
          minOutput,
          recipientAddress,
          rpcUrl,
          bundlerUrl,
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
