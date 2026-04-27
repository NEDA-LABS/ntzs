import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import { deriveWallet } from '@/lib/waas/hd-wallets'
import { partnerUsers, partners, lpFxPairs, lpAccounts } from '@ntzs/db'
import { eq, and } from 'drizzle-orm'
import { executeSwap, calcMinOutput, rankLPsByRate, SWAP_TOKENS, type SwapTokenSymbol, type LPConfig } from '@/lib/fx/swap'

export const runtime = 'nodejs'
export const maxDuration = 300

const SOLVER_ADDRESS = (process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646') as `0x${string}`

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

  let body: {
    userId: string
    fromToken: SwapTokenSymbol
    toToken: SwapTokenSymbol
    amount: number
    slippageBps?: number
  }

  try {
    body = await request.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const { userId, fromToken, toToken, amount, slippageBps = 100 } = body

  if (!userId || !fromToken || !toToken || !amount) {
    return new Response('userId, fromToken, toToken, and amount are required', { status: 400 })
  }
  if (fromToken === toToken) {
    return new Response('fromToken and toToken must differ', { status: 400 })
  }
  if (!SWAP_TOKENS[fromToken] || !SWAP_TOKENS[toToken]) {
    return new Response(`Unsupported tokens. Valid: ${Object.keys(SWAP_TOKENS).join(', ')}`, { status: 400 })
  }

  const rpcUrl = process.env.BASE_RPC_URL
  const solverPrivateKey = process.env.SOLVER_PRIVATE_KEY as `0x${string}` | undefined
  if (!rpcUrl || !solverPrivateKey) {
    return new Response('BASE_RPC_URL or SOLVER_PRIVATE_KEY not configured', { status: 503 })
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

  // Get current rate from active pair
  const pairs = await db.select().from(lpFxPairs).where(eq(lpFxPairs.isActive, true)).limit(10)
  const tokenAddr = (sym: SwapTokenSymbol) => SWAP_TOKENS[sym].address.toLowerCase()

  const pair = pairs.find(
    (p: typeof pairs[number]) =>
      (p.token1Address.toLowerCase() === tokenAddr(fromToken) || p.token2Address.toLowerCase() === tokenAddr(fromToken)) &&
      (p.token1Address.toLowerCase() === tokenAddr(toToken) || p.token2Address.toLowerCase() === tokenAddr(toToken))
  )

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
  const bestLP = rankLPsByRate(lpConfigs, direction)[0]

  const minOutput = calcMinOutput({
    fromToken, toToken, amount, midRate,
    bidBps: bestLP.bidBps, askBps: bestLP.askBps, slippageBps,
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
        for await (const update of executeSwap({
          userPrivateKey: privateKey,
          solverPrivateKey,
          solverAddress: SOLVER_ADDRESS,
          selectedLpId: bestLP.id,
          fromToken,
          toToken,
          amount,
          minOutput,
          recipientAddress,
          rpcUrl,
        })) {
          send(update)
          if (update.status === 'FILLED' || update.status === 'FAILED' || update.status === 'PARTIAL_FILL_EXHAUSTED') {
            break
          }
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
