import { NextRequest, NextResponse } from 'next/server'
import { authenticateMM } from '@/lib/fx/auth'
import { getDb } from '@/lib/db'
import { lpAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { deriveWallet } from '@/lib/fx/lp-wallet'
import { JsonRpcProvider, Wallet, Contract, parseUnits, isAddress } from 'ethers'
import { getChainConfig, type ChainId } from '@/lib/fx/chainConfig'

const CHAIN_TOKENS: Record<ChainId, Record<string, { address: string; decimals: number }>> = {
  base: {
    ntzs: { address: '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688', decimals: 18 },
    usdc: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    usdt: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
  },
  bnb: {
    usdt: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  },
}

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]

/**
 * POST /api/v1/mm/withdraw
 *
 * Withdraws tokens from the LP's inventory wallet.
 *
 * Body: { token: 'ntzs'|'usdc'|'usdt', toAddress, amount, chain?: 'base'|'bnb' }
 * - chain defaults to 'base'
 * - USDT on BNB: chain='bnb', token='usdt'
 * Auth: Bearer <mm-api-key>
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateMM(request)
  if ('error' in authResult) return authResult.error

  const { mm } = authResult

  let body: { token: string; toAddress: string; amount: string; chain?: ChainId }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { token, toAddress, amount, chain = 'base' } = body

  if (!token || !toAddress || !amount) {
    return NextResponse.json({ error: 'token, toAddress and amount are required' }, { status: 400 })
  }

  const chainTokens = CHAIN_TOKENS[chain]
  if (!chainTokens) {
    return NextResponse.json({ error: `Unsupported chain: ${chain}` }, { status: 400 })
  }

  const tokenConfig = chainTokens[token.toLowerCase()]
  if (!tokenConfig) {
    return NextResponse.json({
      error: `token must be one of: ${Object.keys(chainTokens).join(', ')} on ${chain}`,
    }, { status: 400 })
  }

  if (!isAddress(toAddress)) {
    return NextResponse.json({ error: 'Invalid destination address' }, { status: 400 })
  }

  const parsedAmount = parseFloat(amount)
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }

  let chainCfg: ReturnType<typeof getChainConfig>
  try {
    chainCfg = getChainConfig(chain)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }

  const { db } = getDb()
  const [lp] = await db
    .select({ walletIndex: lpAccounts.walletIndex, walletAddress: lpAccounts.walletAddress })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, mm.lpId))
    .limit(1)

  if (!lp) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const { privateKey } = deriveWallet(lp.walletIndex)
  const provider = new JsonRpcProvider(chainCfg.rpcUrl)
  const signer = new Wallet(privateKey, provider)

  const contract = new Contract(tokenConfig.address, ERC20_ABI, signer)
  const balance: bigint = await contract.balanceOf(lp.walletAddress)
  const amountWei = parseUnits(amount, tokenConfig.decimals)

  if (balance < amountWei) {
    return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
  }

  try {
    const tx = await contract.transfer(toAddress, amountWei)
    await tx.wait(1)
    return NextResponse.json({ txHash: tx.hash, status: 'confirmed', chain })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transaction failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
