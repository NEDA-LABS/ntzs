import { NextRequest, NextResponse } from 'next/server'
import { authenticateMM } from '@/lib/fx/auth'
import { getDb } from '@/lib/db'
import { lpAccounts, lpFxPairs, lpPoolPositions } from '@ntzs/db'
import { eq, sql } from 'drizzle-orm'
import { deriveWallet } from '@/lib/fx/lp-wallet'
import { JsonRpcProvider, Wallet, Contract, formatUnits, parseUnits, parseEther } from 'ethers'

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]
const SOLVER_ADDRESS = process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646'

export async function PATCH(request: NextRequest) {
  const authResult = await authenticateMM(request)
  if ('error' in authResult) return authResult.error

  const { mm } = authResult

  let body: { isActive: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { isActive } = body
  if (typeof isActive !== 'boolean') {
    return NextResponse.json({ error: 'isActive must be a boolean' }, { status: 400 })
  }

  const rpcUrl = process.env.BASE_RPC_URL
  if (!rpcUrl) return NextResponse.json({ error: 'RPC not configured' }, { status: 503 })

  const { db } = getDb()

  const [lp] = await db
    .select()
    .from(lpAccounts)
    .where(eq(lpAccounts.id, mm.lpId))
    .limit(1)

  if (!lp) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const provider = new JsonRpcProvider(rpcUrl)

  if (isActive) {
    const pairs = await db.select().from(lpFxPairs).where(eq(lpFxPairs.isActive, true))
    if (pairs.length === 0) {
      return NextResponse.json({ error: 'No active trading pairs configured' }, { status: 400 })
    }

    const tokens = new Map<string, { symbol: string; decimals: number }>()
    for (const pair of pairs) {
      tokens.set(pair.token1Address.toLowerCase(), { symbol: pair.token1Symbol, decimals: pair.token1Decimals })
      tokens.set(pair.token2Address.toLowerCase(), { symbol: pair.token2Symbol, decimals: pair.token2Decimals })
    }

    const { privateKey } = deriveWallet(lp.walletIndex)
    const lpSigner = new Wallet(privateKey, provider)

    const MIN_GAS = parseEther('0.0001')
    const lpEthBalance: bigint = await provider.getBalance(lp.walletAddress)
    if (lpEthBalance < MIN_GAS) {
      const relayerKey = process.env.RELAYER_PRIVATE_KEY ?? process.env.MINTER_PRIVATE_KEY
      if (!relayerKey) return NextResponse.json({ error: 'Relayer key not configured' }, { status: 503 })
      const relayer = new Wallet(relayerKey, provider)
      const gasTx = await relayer.sendTransaction({ to: lp.walletAddress, value: MIN_GAS })
      await gasTx.wait(1)
    }

    const swept: Array<{ tokenAddress: string; symbol: string; amount: string }> = []

    for (const [tokenAddress, { symbol, decimals }] of tokens) {
      const contract = new Contract(tokenAddress, ERC20_ABI, lpSigner)
      const balance: bigint = await contract.balanceOf(lp.walletAddress)
      if (balance === BigInt(0)) continue

      const tx = await contract.transfer(SOLVER_ADDRESS, balance)
      await tx.wait(1)

      const humanAmount = formatUnits(balance, decimals)
      swept.push({ tokenAddress, symbol, amount: humanAmount })

      await db
        .insert(lpPoolPositions)
        .values({ lpId: lp.id, tokenAddress, tokenSymbol: symbol, decimals, contributed: humanAmount, earned: '0' })
        .onConflictDoUpdate({
          target: [lpPoolPositions.lpId, lpPoolPositions.tokenAddress],
          set: {
            contributed: sql`${lpPoolPositions.contributed} + ${humanAmount}::numeric`,
            updatedAt: new Date(),
          },
        })
    }

    if (swept.length === 0) {
      return NextResponse.json({ error: 'No token balance found. Please deposit nTZS or USDC first.' }, { status: 400 })
    }

    const [updated] = await db
      .update(lpAccounts)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(lpAccounts.id, mm.lpId))
      .returning()

    return NextResponse.json({ isActive: true, walletAddress: updated.walletAddress, swept, updatedAt: updated.updatedAt })
  } else {
    const solverKey = process.env.SOLVER_PRIVATE_KEY
    if (!solverKey) return NextResponse.json({ error: 'Solver key not configured' }, { status: 503 })

    const solverSigner = new Wallet(solverKey, provider)
    const positions = await db.select().from(lpPoolPositions).where(eq(lpPoolPositions.lpId, lp.id))
    const returned: Array<{ tokenAddress: string; symbol: string; amount: string }> = []

    for (const pos of positions) {
      const totalWei = parseUnits(pos.contributed, pos.decimals) + parseUnits(pos.earned, pos.decimals)
      if (totalWei === BigInt(0)) continue

      const contract = new Contract(pos.tokenAddress, ERC20_ABI, solverSigner)
      const solverBalance: bigint = await contract.balanceOf(SOLVER_ADDRESS)
      const toSend = totalWei < solverBalance ? totalWei : solverBalance
      if (toSend === BigInt(0)) continue

      const tx = await contract.transfer(lp.walletAddress, toSend)
      await tx.wait(1)

      returned.push({ tokenAddress: pos.tokenAddress, symbol: pos.tokenSymbol, amount: formatUnits(toSend, pos.decimals) })
    }

    await db.delete(lpPoolPositions).where(eq(lpPoolPositions.lpId, lp.id))

    const [updated] = await db
      .update(lpAccounts)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(lpAccounts.id, mm.lpId))
      .returning()

    return NextResponse.json({ isActive: false, walletAddress: updated.walletAddress, returned, updatedAt: updated.updatedAt })
  }
}
