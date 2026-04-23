/**
 * Direct LP pool swap execution.
 *
 * Transfers input tokens from the user's platform wallet to the solver pool,
 * then immediately sends the output tokens from the solver pool to the user.
 * No HyperBridge / ERC-4337 involved.
 *
 * All liquidity is pooled in a single solver wallet. Multiple LPs contribute
 * to the pool — we pick the best LP rate and attribute fills accordingly.
 */

import { JsonRpcProvider, Contract, Wallet, parseUnits, parseEther, formatUnits, formatEther } from 'ethers'

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
  lpId: string
}

/** LP rate info for routing — wallet is always the shared solver. */
export interface LPConfig {
  id: string
  bidBps: number
  askBps: number
}

/**
 * Pick the best LP for a given swap direction.
 * USDC → nTZS: lowest askBps gives user the most nTZS.
 * nTZS → USDC: lowest bidBps gives user the most USDC.
 * Returns the full ranked list (best first) so callers can use the top pick.
 */
export function rankLPsByRate(lps: LPConfig[], direction: 'USDC_TO_NTZS' | 'NTZS_TO_USDC'): LPConfig[] {
  return [...lps].sort((a, b) =>
    direction === 'USDC_TO_NTZS'
      ? a.askBps - b.askBps
      : a.bidBps - b.bidBps
  )
}

/**
 * Select an LP to fill a swap with load balancing.
 *
 * Among LPs whose rate is within `toleranceBps` of the best rate, pick the
 * least-recently-used one (so fills get distributed across competitive MMs
 * instead of always landing on the single lowest-spread one).
 *
 * `lastFillTimes` maps lpId → epoch ms of that LP's most recent fill (0 if
 * the LP has never filled). Tolerance is small enough that user output stays
 * within slippage protection.
 */
export function selectLPForSwap(
  lps: LPConfig[],
  direction: 'USDC_TO_NTZS' | 'NTZS_TO_USDC',
  lastFillTimes: Map<string, number>,
  toleranceBps = 5,
): LPConfig {
  if (lps.length === 0) throw new Error('No LPs available')
  const ranked = rankLPsByRate(lps, direction)
  const bestRate = direction === 'USDC_TO_NTZS' ? ranked[0].askBps : ranked[0].bidBps
  const eligible = ranked.filter((lp) => {
    const rate = direction === 'USDC_TO_NTZS' ? lp.askBps : lp.bidBps
    return rate - bestRate <= toleranceBps
  })
  if (eligible.length === 1) return eligible[0]
  // Pick the LP with the oldest (or missing) last-fill timestamp
  return eligible.reduce((winner, lp) => {
    const winnerLast = lastFillTimes.get(winner.id) ?? 0
    const lpLast = lastFillTimes.get(lp.id) ?? 0
    return lpLast < winnerLast ? lp : winner
  }, eligible[0])
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
 * Optional external signer for Step 1 (user → solver transfer).
 * Used for CDP (coinbase_embedded) wallets where we don't hold the private key.
 * Should return the transaction hash after the transfer is confirmed.
 */
export type ExternalTransferFn = (params: {
  tokenAddress: string
  toAddress: string
  amountWei: bigint
}) => Promise<{ txHash: string }>

/**
 * Execute a direct swap via the shared solver pool.
 *
 * Step 1: user's platform wallet sends `fromToken` to the solver pool.
 *   - If `userPrivateKey` is provided, signs directly with ethers.
 *   - If `externalTransfer` is provided, delegates signing to an external service (e.g. CDP).
 * Step 2: solver pool sends `toToken` to the user's wallet.
 *
 * `selectedLpId` identifies which LP gets credited for the fill.
 */
export async function* executeSwap(params: {
  userPrivateKey?: `0x${string}`
  externalTransfer?: ExternalTransferFn
  solverPrivateKey: `0x${string}`
  solverAddress: `0x${string}`
  selectedLpId: string
  fromToken: SwapTokenSymbol
  toToken: SwapTokenSymbol
  amount: number
  minOutput: number
  recipientAddress: `0x${string}`
  rpcUrl: string
}): AsyncGenerator<SwapStatusUpdate & { _result?: SwapResult }> {
  const { userPrivateKey, externalTransfer, solverPrivateKey, solverAddress, selectedLpId, fromToken, toToken, amount, minOutput, recipientAddress, rpcUrl } = params

  if (!userPrivateKey && !externalTransfer) {
    yield { status: 'FAILED', message: 'No signing method available for this wallet', error: 'NO_SIGNER' }
    return
  }

  const from = SWAP_TOKENS[fromToken]
  const to = SWAP_TOKENS[toToken]

  const provider = new JsonRpcProvider(rpcUrl)
  const solverWallet = new Wallet(solverPrivateKey, provider)

  const fromContract = new Contract(from.address, ERC20_ABI, provider)
  const toContract = new Contract(to.address, ERC20_ABI, provider)

  // Check user balance
  yield { status: 'CHECKING', message: 'Checking balance...' }
  const balance: bigint = await fromContract.balanceOf(recipientAddress)
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

  // Check solver pool has enough output tokens.
  // Use toFixed(6) instead of toFixed(to.decimals) — JS floats have ~15 significant
  // digits, so toFixed(18) on nTZS amounts inflates the last digits and can make the
  // check fail even when the pool has plenty. 6dp is more than enough precision here.
  const amountOutUnits = parseUnits(minOutput.toFixed(6), to.decimals)
  const solverBalance: bigint = await toContract.balanceOf(solverAddress)
  if (solverBalance < amountOutUnits) {
    yield {
      status: 'FAILED',
      message: 'Insufficient liquidity in pool for this swap. Please try a smaller amount.',
      error: 'INSUFFICIENT_LIQUIDITY',
    }
    return
  }

  // Gas check: top up user wallet if ETH balance is too low for an ERC-20 transfer
  // (only needed for HD wallets — CDP wallets handle gas internally)
  if (userPrivateKey) {
    const GAS_THRESHOLD = parseEther('0.00003')
    const GAS_TOPUP = parseEther('0.00005')
    const userEthBalance = await provider.getBalance(recipientAddress)
    if (userEthBalance < GAS_THRESHOLD) {
      yield { status: 'PREPARING', message: 'Topping up gas...' }
      const gasTx = await solverWallet.sendTransaction({ to: recipientAddress, value: GAS_TOPUP })
      await gasTx.wait()
      console.log(`[swap] Gas top-up: ${formatEther(GAS_TOPUP)} ETH → ${recipientAddress}, tx: ${gasTx.hash}`)
    }
  }

  // Step 1: user sends fromToken to solver pool
  yield { status: 'SENDING', message: `Sending ${amount} ${from.symbol} to liquidity pool...` }
  let inTxHash: string

  if (externalTransfer) {
    // CDP / external wallet signing
    const result = await externalTransfer({
      tokenAddress: from.address,
      toAddress: solverAddress,
      amountWei: amountInUnits,
    })
    inTxHash = result.txHash
    yield { status: 'SENDING', message: 'Confirming deposit...', txHash: inTxHash }
    // Wait for confirmation on-chain
    const receipt = await provider.waitForTransaction(inTxHash, 1, 120_000)
    if (!receipt || receipt.status === 0) {
      yield { status: 'FAILED', message: 'Deposit transaction failed on-chain', error: 'TX_FAILED' }
      return
    }
  } else {
    // HD wallet signing — we have the private key
    const userWallet = new Wallet(userPrivateKey!, provider)
    const userFromContract = fromContract.connect(userWallet) as Contract
    const inTx = await (userFromContract as unknown as { transfer: (to: string, amount: bigint) => Promise<{ hash: string; wait: () => Promise<unknown> }> })
      .transfer(solverAddress, amountInUnits)
    inTxHash = inTx.hash
    yield { status: 'SENDING', message: 'Confirming deposit...', txHash: inTxHash }
    await inTx.wait()
  }

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
      inTxHash: inTxHash,
      outTxHash: outTx.hash,
      amountIn: amount.toString(),
      amountOut: minOutput.toString(),
      lpId: selectedLpId,
    },
  }
}
