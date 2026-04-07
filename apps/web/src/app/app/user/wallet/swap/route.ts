import { NextRequest } from 'next/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ethers } from 'ethers'

import { requireAnyRole } from '@/lib/auth/rbac'
import { deriveWallet } from '@/lib/waas/hd-wallets'
import { sendTransaction as sendCdpTransaction } from '@/lib/waas/cdp-server'
import { getDb } from '@/lib/db'
import { wallets, lpFxPairs, lpAccounts, lpPoolPositions, lpFills, users } from '@ntzs/db'
import { executeSwap, calcMinOutput, selectLPForSwap, SWAP_TOKENS, type SwapTokenSymbol, type LPConfig, type ExternalTransferFn } from '@/lib/fx/swap'

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

  // Look for any swap-eligible wallet: prefer platform_hd, fall back to coinbase_embedded
  const userWallets = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, dbUser.id))
    .limit(10)

  const wallet =
    userWallets.find((w) => w.provider === 'platform_hd') ??
    userWallets.find((w) => w.provider === 'coinbase_embedded') ??
    null

  if (!wallet) return new Response('No swap-eligible wallet found for this account', { status: 404 })

  const solverPrivateKey = process.env.SOLVER_PRIVATE_KEY as `0x${string}` | undefined
  const rpcUrl = process.env.BASE_RPC_URL

  if (!solverPrivateKey || !rpcUrl) {
    return new Response('Server configuration error', { status: 503 })
  }

  let userPrivateKey: `0x${string}` | undefined
  let externalTransfer: ExternalTransferFn | undefined
  const recipientAddress = wallet.address as `0x${string}`

  if (wallet.provider === 'platform_hd') {
    // HD wallet — derive private key from seed
    const platformSeed = process.env.PLATFORM_HD_SEED
    if (!platformSeed) return new Response('Server configuration error', { status: 503 })
    if (wallet.providerWalletRef === null) return new Response('Wallet index not provisioned', { status: 404 })

    const walletIndex = parseInt(wallet.providerWalletRef ?? '0', 10)
    const hdWallet = deriveWallet(platformSeed, walletIndex)
    userPrivateKey = hdWallet.privateKey as `0x${string}`
  } else if (wallet.provider === 'coinbase_embedded') {
    // CDP wallet — use Coinbase SDK signing
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, dbUser.id)).limit(1)
    if (!user) return new Response('User not found', { status: 404 })

    externalTransfer = async ({ tokenAddress, toAddress, amountWei }) => {
      const iface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)'])
      const result = await sendCdpTransaction(dbUser.id, user.email, {
        evmAccount: wallet.address,
        network: 'base',
        transaction: {
          type: 'eip1559',
          chainId: 8453,
          to: tokenAddress as `0x${string}`,
          data: iface.encodeFunctionData('transfer', [toAddress, amountWei]) as `0x${string}`,
          value: BigInt(0),
        },
      } as any)
      if ('error' in result) throw new Error(result.error)
      return { txHash: result.txHash }
    }
  } else {
    return new Response('Wallet type not supported for swaps', { status: 400 })
  }

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

  // Query all active LPs, pick the one with the best rate for this direction
  const activeLPs = await db
    .select({ id: lpAccounts.id, bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
    .from(lpAccounts)
    .where(eq(lpAccounts.isActive, true as unknown as boolean))

  if (activeLPs.length === 0) return new Response('No active liquidity provider', { status: 503 })

  const direction = fromToken === 'USDC' ? 'USDC_TO_NTZS' : 'NTZS_TO_USDC'
  const lpConfigs: LPConfig[] = activeLPs.map((lp) => ({
    id: lp.id,
    bidBps: lp.bidBps ?? 120,
    askBps: lp.askBps ?? 150,
  }))

  // Load-balance: query each LP's most recent fill to break ties via LRU
  const lastFillRows = await db
    .select({ lpId: lpFills.lpId, lastAt: sql<Date>`max(${lpFills.createdAt})` })
    .from(lpFills)
    .where(inArray(lpFills.lpId, lpConfigs.map((lp) => lp.id)))
    .groupBy(lpFills.lpId)
  const lastFillTimes = new Map<string, number>(
    lastFillRows.map((r) => [r.lpId, r.lastAt ? new Date(r.lastAt).getTime() : 0]),
  )
  const bestLP = selectLPForSwap(lpConfigs, direction, lastFillTimes)

  const minOutput = calcMinOutput({
    fromToken, toToken, amount, midRate,
    bidBps: bestLP.bidBps, askBps: bestLP.askBps, slippageBps,
  })

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
          externalTransfer,
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
          const { _result, ...clientUpdate } = update as typeof update & { _result?: SwapResult }
          send(clientUpdate)

          // On success, record the fill and credit the LP
          if (update.status === 'FILLED' && _result) {
            const filledLpId = _result.lpId
            const toDecimals = SWAP_TOKENS[toToken].decimals

            const midOutput = fromToken === 'NTZS'
              ? amount / midRate
              : amount * midRate
            const spread = Math.max(0, midOutput - parseFloat(_result.amountOut))

            try {
              await db.insert(lpFills).values({
                lpId: filledLpId,
                userAddress: recipientAddress,
                fromToken: SWAP_TOKENS[fromToken].address,
                toToken: SWAP_TOKENS[toToken].address,
                amountIn: _result.amountIn,
                amountOut: _result.amountOut,
                spreadEarned: spread.toFixed(toDecimals),
                inTxHash: _result.inTxHash,
                outTxHash: _result.outTxHash,
              })

              const outTokenAddr = SWAP_TOKENS[toToken].address.toLowerCase()
              await db
                .update(lpPoolPositions)
                .set({
                  earned: sql`${lpPoolPositions.earned} + ${spread.toFixed(toDecimals)}::numeric`,
                  updatedAt: new Date(),
                })
                .where(and(
                  eq(lpPoolPositions.lpId, filledLpId),
                  eq(lpPoolPositions.tokenAddress, outTokenAddr),
                ))

              const inTokenAddr = SWAP_TOKENS[fromToken].address.toLowerCase()
              await db
                .update(lpPoolPositions)
                .set({
                  contributed: sql`${lpPoolPositions.contributed} + ${_result.amountIn}::numeric`,
                  updatedAt: new Date(),
                })
                .where(and(
                  eq(lpPoolPositions.lpId, filledLpId),
                  eq(lpPoolPositions.tokenAddress, inTokenAddr),
                ))
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

type SwapResult = { inTxHash: string; outTxHash: string; amountIn: string; amountOut: string; lpId: string }
