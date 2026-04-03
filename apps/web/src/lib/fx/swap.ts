/**
 * Direct LP pool swap execution.
 *
 * Transfers input tokens from the user's platform wallet to the solver pool,
 * then immediately sends the output tokens from the solver pool to the user.
 * No HyperBridge / ERC-4337 involved.
 */

import { JsonRpcProvider, Contract, Wallet, parseUnits, formatUnits } from 'ethers'

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

export interface SwapResult {
  inTxHash: string
  outTxHash: string
  amountIn: string
  amountOut: string
}

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]

/**
 * Calculate the output amount for a swap.
 *
 * nTZS → USDC: output = (amount / midRate) × (1 - bidBps/10000) × (1 - slippage)
 * USDC → nTZS: output = amount × midRate × (1 - askBps/10000) × (1 - slippage)
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
 * Execute a direct swap from the LP solver pool.
 * Step 1: user's platform wallet sends `fromToken` to the solver pool.
 * Step 2: solver pool sends `toToken` to the user's wallet.
 */
export async function* executeSwap(params: {
  userPrivateKey: `0x${string}`
  solverPrivateKey: `0x${string}`
  solverAddress: `0x${string}`
  fromToken: SwapTokenSymbol
  toToken: SwapTokenSymbol
  amount: number
  minOutput: number
  recipientAddress: `0x${string}`
  rpcUrl: string
}): AsyncGenerator<SwapStatusUpdate & { _result?: SwapResult }> {
  const { userPrivateKey, solverPrivateKey, solverAddress, fromToken, toToken, amount, minOutput, recipientAddress, rpcUrl } = params

  const from = SWAP_TOKENS[fromToken]
  const to = SWAP_TOKENS[toToken]

  const provider = new JsonRpcProvider(rpcUrl)
  const userWallet = new Wallet(userPrivateKey, provider)
  const solverWallet = new Wallet(solverPrivateKey, provider)

  const fromContract = new Contract(from.address, ERC20_ABI, provider)
  const toContract = new Contract(to.address, ERC20_ABI, provider)

  // Check user balance
  yield { status: 'CHECKING', message: 'Checking balance...' }
  const balance: bigint = await fromContract.balanceOf(userWallet.address)
  const amountInUnits = parseUnits(amount.toFixed(from.decimals), from.decimals)
  if (balance < amountInUnits) {
    const have = formatUnits(balance, from.decimals)
    yield {
      status: 'FAILED',
      message: `Insufficient ${from.symbol} balance. Have ${parseFloat(have).toFixed(4)}, need ${amount}`,
      error: 'INSUFFICIENT_BALANCE',
    }
    return
  }

  // Check solver pool has enough output tokens
  const amountOutUnits = parseUnits(minOutput.toFixed(to.decimals), to.decimals)
  const solverBalance: bigint = await toContract.balanceOf(solverAddress)
  if (solverBalance < amountOutUnits) {
    yield {
      status: 'FAILED',
      message: `Insufficient liquidity in pool for this swap. Please try a smaller amount.`,
      error: 'INSUFFICIENT_LIQUIDITY',
    }
    return
  }

  // Step 1: user sends fromToken to solver pool
  yield { status: 'SENDING', message: `Sending ${amount} ${from.symbol} to liquidity pool...` }
  const userFromContract = fromContract.connect(userWallet) as Contract
  const inTx = await (userFromContract as unknown as { transfer: (to: string, amount: bigint) => Promise<{ hash: string; wait: () => Promise<unknown> }> })
    .transfer(solverAddress, amountInUnits)
  yield { status: 'SENDING', message: 'Confirming deposit...', txHash: inTx.hash }
  await inTx.wait()

  // Step 2: solver pool sends toToken to user
  yield { status: 'FILLING', message: `Sending ${from.symbol === 'nTZS' ? 'USDC' : 'nTZS'} to your wallet...` }
  const solverToContract = toContract.connect(solverWallet) as Contract
  const outTx = await (solverToContract as unknown as { transfer: (to: string, amount: bigint) => Promise<{ hash: string; wait: () => Promise<unknown> }> })
    .transfer(recipientAddress, amountOutUnits)
  yield { status: 'FILLING', message: 'Confirming payout...', txHash: outTx.hash }
  await outTx.wait()

  yield {
    status: 'FILLED',
    message: 'Swap complete!',
    txHash: outTx.hash,
    _result: {
      inTxHash: inTx.hash,
      outTxHash: outTx.hash,
      amountIn: amount.toString(),
      amountOut: minOutput.toString(),
    },
  }
}
