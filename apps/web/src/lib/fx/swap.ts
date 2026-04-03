/**
 * HyperBridge Intent Gateway — swap execution helper
 *
 * Uses @hyperbridge/sdk to place same-chain swap intents on Base.
 * Yields status updates as an async generator so callers can stream
 * progress to the client (SSE) or await completion.
 */

import { mkdirSync } from 'fs'
import { join } from 'path'
import {
  EvmChain,
  IntentsCoprocessor,
  IntentGateway,
  IntentOrderStatus,
  DEFAULT_GRAFFITI,
} from '@hyperbridge/sdk'
import type { Order } from '@hyperbridge/sdk'
import { privateKeyToAccount } from 'viem/accounts'
import { toHex, parseUnits, padHex, maxUint256 } from 'viem'
import { JsonRpcProvider, Contract, Wallet } from 'ethers'

const INTENT_GATEWAY_V2 = '0x2d61624A17f361020679FaA16fbB566C344AaF4B' as `0x${string}`

// Minimal ABI for parsing OrderPlaced events and calling cancelOrder
const GATEWAY_ABI = [
  {
    type: 'event',
    name: 'OrderPlaced',
    inputs: [
      { name: 'user', type: 'bytes32' },
      { name: 'source', type: 'bytes' },
      { name: 'destination', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'fees', type: 'uint256' },
      { name: 'session', type: 'address' },
      { name: 'beneficiary', type: 'bytes32' },
      { name: 'predispatch', type: 'tuple[]', components: [{ name: 'token', type: 'bytes32' }, { name: 'amount', type: 'uint256' }] },
      { name: 'inputs', type: 'tuple[]', components: [{ name: 'token', type: 'bytes32' }, { name: 'amount', type: 'uint256' }] },
      { name: 'outputs', type: 'tuple[]', components: [{ name: 'token', type: 'bytes32' }, { name: 'amount', type: 'uint256' }] },
    ],
  },
  {
    type: 'function',
    name: 'cancelOrder',
    inputs: [
      {
        name: 'order', type: 'tuple',
        components: [
          { name: 'user', type: 'bytes32' },
          { name: 'source', type: 'bytes' },
          { name: 'destination', type: 'bytes' },
          { name: 'deadline', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'fees', type: 'uint256' },
          { name: 'session', type: 'address' },
          {
            name: 'predispatch', type: 'tuple',
            components: [
              { name: 'assets', type: 'tuple[]', components: [{ name: 'token', type: 'bytes32' }, { name: 'amount', type: 'uint256' }] },
              { name: 'call', type: 'bytes' },
            ],
          },
          { name: 'inputs', type: 'tuple[]', components: [{ name: 'token', type: 'bytes32' }, { name: 'amount', type: 'uint256' }] },
          {
            name: 'output', type: 'tuple',
            components: [
              { name: 'beneficiary', type: 'bytes32' },
              { name: 'assets', type: 'tuple[]', components: [{ name: 'token', type: 'bytes32' }, { name: 'amount', type: 'uint256' }] },
              { name: 'call', type: 'bytes' },
            ],
          },
        ],
      },
      { name: 'params', type: 'tuple', components: [{ name: 'relayerFee', type: 'uint256' }, { name: 'height', type: 'uint256' }] },
    ],
  },
]

type FinalizedOrder = {
  user: string
  source: string
  destination: string
  deadline: bigint
  nonce: bigint
  fees: bigint
  session: string
  predispatch: { assets: { token: string; amount: bigint }[]; call: string }
  inputs: { token: string; amount: bigint }[]
  output: { beneficiary: string; assets: { token: string; amount: bigint }[]; call: string }
}

async function* autoCancelOrder(
  order: FinalizedOrder | null,
  privateKey: `0x${string}`,
  provider: JsonRpcProvider,
  gateway: Contract,
): AsyncGenerator<SwapStatusUpdate> {
  if (!order) return
  try {
    const signer = new Wallet(privateKey, provider)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gw = gateway.connect(signer) as any
    yield { status: 'CANCELLING', message: 'Order failed — recovering escrowed tokens...' }
    const tx = await gw.cancelOrder(order, { relayerFee: BigInt(0), height: BigInt(0) })
    yield { status: 'CANCELLING', message: 'Cancel submitted, waiting for confirmation...', txHash: tx.hash }
    await tx.wait()
    yield { status: 'CANCELLED', message: 'Escrowed tokens returned to your wallet' }
  } catch (err) {
    yield {
      status: 'CANCEL_FAILED',
      message: `Could not auto-recover tokens: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }
}

// On Vercel Lambda /var/task is read-only — redirect SDK cache to /tmp
;(function ensureCacheDir() {
  const base_path = (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
    ? '/tmp'
    : process.cwd()
  try {
    mkdirSync(join(base_path, '.hyperbridge-cache', 'session-key-address'), { recursive: true })
    if (base_path === '/tmp' && process.cwd() !== '/tmp') process.chdir('/tmp')
  } catch { /* ignore */ }
})()

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
  // Use ethers.js for reads and sends (proven reliable on Base mainnet)
  const provider = new JsonRpcProvider(rpcUrl)
  const gateway = new Contract(INTENT_GATEWAY_V2, GATEWAY_ABI, provider)
  let finalizedOrder: FinalizedOrder | null = null
  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
  ]
  const tokenContract = new Contract(from.address, ERC20_ABI, provider)
  // Track the recipient's initial `to` token balance so we can detect a fill
  // even if the coprocessor WebSocket drops and we miss the FILLED event.
  const toTokenContract = new Contract(to.address, ERC20_ABI, provider)
  const minOutputUnits = parseUnits(minOutput.toFixed(to.decimals), to.decimals)
  let initialToBalance: bigint = BigInt(0)
  try { initialToBalance = await toTokenContract.balanceOf(recipientAddress) } catch { /* ignore */ }
  let lastFillCheckMs = 0

  // Check balance
  const balance: bigint = await tokenContract.balanceOf(account.address)
  const needed = parseUnits(amount.toFixed(from.decimals), from.decimals)
  if (balance < needed) {
    const haveHuman = (Number(balance) / 10 ** from.decimals).toFixed(from.decimals === 6 ? 2 : 4)
    const needHuman = amount.toFixed(from.decimals === 6 ? 2 : 4)
    yield {
      status: 'FAILED',
      message: `Insufficient ${from.symbol} balance. Have ${haveHuman}, need ${needHuman} (wallet: ${account.address})`,
      error: 'INSUFFICIENT_BALANCE',
    }
    return
  }

  // Ensure IntentGatewayV2 has allowance to escrow input tokens
  const allowance: bigint = await tokenContract.allowance(account.address, INTENT_GATEWAY_V2)
  if (allowance < needed) {
    yield { status: 'APPROVING', message: `Approving ${from.symbol} for IntentGateway...` }
    const ethersWallet = new Wallet(privateKey, provider)
    const approveTx = await ethersWallet.sendTransaction({
      to: from.address,
      data: tokenContract.interface.encodeFunctionData('approve', [INTENT_GATEWAY_V2, maxUint256]),
    })
    yield { status: 'APPROVING', message: 'Waiting for approval confirmation...', txHash: approveTx.hash as `0x${string}` }
    await approveTx.wait()
    yield { status: 'APPROVED', message: 'Token approval confirmed' }
  }

  const stateMachineId = toHex(chain.config.stateMachineId) as `0x${string}`
  const BYTES32_ZERO = padHex('0x', { size: 32 }) as `0x${string}`
  // Deadline is a Unix timestamp — 10 minutes from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)

  const order = {
    user: BYTES32_ZERO,
    source: stateMachineId,
    destination: stateMachineId,
    deadline,
    nonce: BigInt(0),
    fees: BigInt(0),
    session: BYTES32_ZERO,
    predispatch: { assets: [], call: '0x' as `0x${string}` },
    inputs: [
      {
        token: padHex(from.address, { size: 32, dir: 'left' }),
        amount: parseUnits(amount.toFixed(from.decimals), from.decimals),
      },
    ],
    output: {
      beneficiary: padHex(recipientAddress, { size: 32, dir: 'left' }),
      assets: [
        {
          token: padHex(to.address, { size: 32, dir: 'left' }),
          amount: parseUnits(minOutput.toFixed(to.decimals), to.decimals),
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

  const { to: txTo, data, value: txValue } = first.value as { to: `0x${string}`; data: `0x${string}`; value: bigint }

  yield { status: 'PLACING_ORDER', message: 'Submitting order to HyperBridge...' }

  // Use ethers to send (auto-estimates gas), then pass txHash to the generator
  const ethersWalletOrder = new Wallet(privateKey, provider)
  const orderTx = await ethersWalletOrder.sendTransaction({
    to: txTo,
    data,
    value: txValue ?? BigInt(0),
  })
  yield { status: 'PLACING_ORDER', message: 'Order tx submitted, waiting for confirmation...', txHash: orderTx.hash as `0x${string}` }
  await orderTx.wait()

  // Parse OrderPlaced event from receipt to capture exact commitment values for auto-cancel
  try {
    const fullReceipt = await provider.getTransactionReceipt(orderTx.hash)
    if (fullReceipt) {
      for (const log of fullReceipt.logs) {
        try {
          const parsed = gateway.interface.parseLog({ topics: [...log.topics], data: log.data })
          if (parsed?.name === 'OrderPlaced') {
            const a = parsed.args
            const copyAssets = (arr: { token: string; amount: bigint }[]) => arr.map(t => ({ token: t.token, amount: t.amount }))
            finalizedOrder = {
              user: a.user,
              source: a.source,
              destination: a.destination,
              deadline: a.deadline,
              nonce: a.nonce,
              fees: a.fees,
              session: a.session,
              predispatch: { assets: copyAssets(a.predispatch), call: '0x' },
              inputs: copyAssets(a.inputs),
              output: { beneficiary: a.beneficiary, assets: copyAssets(a.outputs), call: '0x' },
            }
            break
          }
        } catch { /* not the event we want */ }
      }
    }
  } catch { /* non-fatal — auto-cancel will be skipped if parsing fails */ }

  // Step 2: pass txHash (66 chars), SDK will fetch the receipt
  const second = await gen.next(orderTx.hash as `0x${string}`)
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
      case IntentOrderStatus.FAILED: {
        // Bot may have filled the order but the WebSocket missed the FILLED event,
        // causing the SDK to report FAILED. Check balance before cancelling.
        try {
          const bal: bigint = await toTokenContract.balanceOf(recipientAddress)
          if (bal >= initialToBalance + minOutputUnits * BigInt(9) / BigInt(10)) {
            yield { status: 'FILLED', message: 'Swap complete!' }
            return
          }
        } catch { /* ignore */ }
        yield { status: 'FAILED', message: `Swap failed: ${u.error?.message ?? 'unknown reason'}`, error: u.error?.message }
        yield* autoCancelOrder(finalizedOrder, privateKey, provider, gateway)
        return
      }
      case 'PARTIAL_FILL_EXHAUSTED' as string: {
        try {
          const bal: bigint = await toTokenContract.balanceOf(recipientAddress)
          if (bal >= initialToBalance + minOutputUnits * BigInt(9) / BigInt(10)) {
            yield { status: 'FILLED', message: 'Swap complete!' }
            return
          }
        } catch { /* ignore */ }
        yield { status: 'PARTIAL_FILL_EXHAUSTED', message: 'Order deadline reached with partial fill' }
        yield* autoCancelOrder(finalizedOrder, privateKey, provider, gateway)
        return
      }
      default: {
        // Coprocessor WebSocket sometimes drops and misses the FILLED event.
        // Fall back to polling the recipient's toToken balance every 10s.
        const now = Date.now()
        if (now - lastFillCheckMs >= 10_000) {
          lastFillCheckMs = now
          try {
            const currentBal: bigint = await toTokenContract.balanceOf(recipientAddress)
            if (currentBal >= initialToBalance + minOutputUnits * BigInt(9) / BigInt(10)) {
              yield { status: 'FILLED', message: 'Swap complete!' }
              return
            }
          } catch { /* ignore — will retry next cycle */ }
        }
        yield { status: u.status, message: 'Processing...' }
        break
      }
    }
  }
}
