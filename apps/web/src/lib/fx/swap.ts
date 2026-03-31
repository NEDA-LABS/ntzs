/**
 * HyperBridge Intent Gateway — swap execution helper
 *
 * Uses @hyperbridge/sdk to place same-chain swap intents on Base.
 * Yields status updates as an async generator so callers can stream
 * progress to the client (SSE) or await completion.
 */

import {
  EvmChain,
  IntentsCoprocessor,
  IntentGateway,
  IntentOrderStatus,
  DEFAULT_GRAFFITI,
} from '@hyperbridge/sdk'
import type { Order } from '@hyperbridge/sdk'
import { privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, http, toHex, parseUnits } from 'viem'
import { base } from 'viem/chains'

export const SWAP_TOKENS = {
  NTZS: {
    address: '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688' as `0x${string}`,
    decimals: 18,
    symbol: 'nTZS',
  },
  USDC: {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
    decimals: 6,
    symbol: 'USDC',
  },
} as const

export type SwapTokenSymbol = keyof typeof SWAP_TOKENS

export interface SwapStatusUpdate {
  status: string
  message: string
  txHash?: string
  orderId?: string
  bidCount?: number
  error?: string
}

/**
 * Calculate the expected minimum output for a swap.
 *
 * USDC → nTZS: output = amount × midRate × (1 - askBps/10000) × (1 - slippage)
 * nTZS → USDC: output = (amount / midRate) × (1 - bidBps/10000) × (1 - slippage)
 */
export function calcMinOutput(params: {
  fromToken: SwapTokenSymbol
  toToken: SwapTokenSymbol
  amount: number
  midRate: number
  bidBps: number
  askBps: number
  slippageBps?: number
}): number {
  const { fromToken, toToken, amount, midRate, bidBps, askBps, slippageBps = 100 } = params
  const slippage = 1 - slippageBps / 10000

  if (fromToken === 'USDC' && toToken === 'NTZS') {
    const askRate = midRate * (1 - askBps / 10000)
    return amount * askRate * slippage
  }
  if (fromToken === 'NTZS' && toToken === 'USDC') {
    const bidRate = midRate * (1 + bidBps / 10000)
    return (amount / bidRate) * slippage
  }
  throw new Error(`Unsupported pair: ${fromToken} → ${toToken}`)
}

/**
 * Execute a same-chain swap on Base via HyperBridge IntentGateway.
 * Streams SwapStatusUpdate objects via async generator.
 */
export async function* executeSwap(params: {
  privateKey: `0x${string}`
  fromToken: SwapTokenSymbol
  toToken: SwapTokenSymbol
  amount: number
  minOutput: number
  recipientAddress: `0x${string}`
  rpcUrl: string
  bundlerUrl: string
}): AsyncGenerator<SwapStatusUpdate> {
  const { privateKey, fromToken, toToken, amount, minOutput, recipientAddress, rpcUrl, bundlerUrl } = params

  const from = SWAP_TOKENS[fromToken]
  const to = SWAP_TOKENS[toToken]

  yield { status: 'CONNECTING', message: 'Connecting to HyperBridge...' }

  const chain = await EvmChain.create(rpcUrl, bundlerUrl)
  const coprocessor = await IntentsCoprocessor.connect('wss://nexus.ibp.network')
  const intentGateway = await IntentGateway.create(chain, chain, coprocessor)

  const account = privateKeyToAccount(privateKey)
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl),
  })

  const currentBlock = await chain.client.getBlockNumber()

  const order = {
    user: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
    source: '0x' as `0x${string}`,
    destination: toHex(chain.config.stateMachineId) as `0x${string}`,
    deadline: currentBlock + BigInt(300),
    nonce: BigInt(0),
    fees: BigInt(0),
    session: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    predispatch: { assets: [], call: '0x' as `0x${string}` },
    inputs: [
      {
        token: from.address,
        amount: parseUnits(amount.toFixed(from.decimals), from.decimals),
      },
    ],
    output: {
      beneficiary: recipientAddress,
      assets: [
        {
          token: to.address,
          amount: parseUnits(minOutput.toFixed(6), to.decimals),
        },
      ],
      call: '0x' as `0x${string}`,
    },
  } satisfies Partial<Order> as unknown as Order

  yield { status: 'PREPARING', message: 'Encoding swap order...' }

  const gen = intentGateway.execute(order, DEFAULT_GRAFFITI, {
    minBids: 1,
    bidTimeoutMs: 60_000,
  })

  // Step 1: get placeOrder calldata
  const first = await gen.next()
  if (first.done) {
    yield { status: 'FAILED', message: 'Failed to generate order calldata', error: 'Generator ended early' }
    return
  }

  const { to: txTo, data, value } = first.value as { to: `0x${string}`; data: `0x${string}`; value: bigint }

  yield { status: 'PLACING_ORDER', message: 'Submitting order to HyperBridge...' }

  const signedTx = await walletClient.signTransaction({
    to: txTo,
    data,
    value: value ?? BigInt(0),
    type: 'eip1559',
    chain: base,
  }) as `0x${string}`

  // Step 2: pass signed tx, get ORDER_PLACED confirmation
  const second = await gen.next(signedTx)
  if (!second.done && second.value) {
    const placed = second.value as { order?: Order; receipt?: { transactionHash: string } }
    yield {
      status: 'ORDER_PLACED',
      message: 'Order placed on-chain. Waiting for solver...',
      txHash: placed.receipt?.transactionHash,
      orderId: (placed.order as { id?: string })?.id,
    }
  }

  // Step 3: stream remaining status updates — cast to any to bypass bidirectional generator typing
  const genAny = gen as unknown as AsyncIterable<unknown>
  for await (const update of genAny) {
    const u = update as { status: string; bidCount?: number; userOpHash?: string; transactionHash?: string; error?: Error }
    switch (u.status) {
      case IntentOrderStatus.AWAITING_BIDS:
        yield { status: 'AWAITING_BIDS', message: 'Waiting for solver bids on HyperBridge...' }
        break
      case IntentOrderStatus.BIDS_RECEIVED:
        yield { status: 'BIDS_RECEIVED', message: `${u.bidCount ?? 1} bid(s) received`, bidCount: u.bidCount }
        break
      case IntentOrderStatus.BID_SELECTED:
        yield { status: 'BID_SELECTED', message: 'Best bid selected, executing fill...' }
        break
      case IntentOrderStatus.USEROP_SUBMITTED:
        yield { status: 'USEROP_SUBMITTED', message: 'Fill transaction submitted', txHash: u.userOpHash }
        break
      case IntentOrderStatus.PARTIAL_FILL:
        yield { status: 'PARTIAL_FILL', message: 'Partial fill received, awaiting more...' }
        break
      case IntentOrderStatus.FILLED:
        yield { status: 'FILLED', message: 'Swap complete!', txHash: u.transactionHash }
        return
      case IntentOrderStatus.FAILED:
        yield { status: 'FAILED', message: 'Swap failed', error: u.error?.message }
        return
      case IntentOrderStatus.PARTIAL_FILL_EXHAUSTED:
        yield { status: 'PARTIAL_FILL_EXHAUSTED', message: 'Order deadline reached with partial fill' }
        return
      default:
        yield { status: u.status, message: 'Processing...' }
    }
  }
}
