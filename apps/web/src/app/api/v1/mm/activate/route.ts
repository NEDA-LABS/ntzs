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
        // chain is part of the unique index — it must be set and must be in the
        // conflict target, else ON CONFLICT matches no constraint and the insert
        // throws on every activation. (This route is base-only.)
        .values({ lpId: lp.id, chain: 'base', tokenAddress, tokenSymbol: symbol, decimals, contributed: humanAmount, earned: '0' })
        .onConflictDoUpdate({
          target: [lpPoolPositions.lpId, lpPoolPositions.chain, lpPoolPositions.tokenAddress],
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
    const failed: Array<{ tokenAddress: string; symbol: string; reason: string }> = []

    // Truncate to the token's decimals before parseUnits — stored values keep full
    // numeric precision (up to 18 dp) but USDC etc. have fewer, and ethers throws on
    // excess fractional digits.
    const truncate = (v: string, d: number) => {
      const [int, frac = ''] = v.split('.')
      return `${int}.${frac.slice(0, d).padEnd(d, '0')}`
    }

    for (const pos of positions) {
      try {
        // Return `contributed` only — profit is already baked in by the double-entry
        // fill accounting; `earned` is deprecated as a payout component.
        const totalWei = parseUnits(truncate(pos.contributed, pos.decimals), pos.decimals)
        if (totalWei === BigInt(0)) {
          await db.delete(lpPoolPositions).where(eq(lpPoolPositions.id, pos.id))
          continue
        }

        const contract = new Contract(pos.tokenAddress, ERC20_ABI, solverSigner)
        const solverBalance: bigint = await contract.balanceOf(SOLVER_ADDRESS)

        // Never delete a position we can't return IN FULL. Previously this sent
        // min(owed, solverBal) then wiped every position unconditionally, so a
        // partial/failed return stranded the LP's funds in the solver with no
        // record. Keep the position and report it so it can be retried.
        if (solverBalance < totalWei) {
          failed.push({ tokenAddress: pos.tokenAddress, symbol: pos.tokenSymbol, reason: 'insufficient solver balance to return in full' })
          continue
        }

        const tx = await contract.transfer(lp.walletAddress, totalWei)
        await tx.wait(1)

        returned.push({ tokenAddress: pos.tokenAddress, symbol: pos.tokenSymbol, amount: formatUnits(totalWei, pos.decimals) })
        // Delete ONLY after the on-chain return confirms.
        await db.delete(lpPoolPositions).where(eq(lpPoolPositions.id, pos.id))
      } catch (err) {
        failed.push({ tokenAddress: pos.tokenAddress, symbol: pos.tokenSymbol, reason: err instanceof Error ? err.message : 'return failed' })
      }
    }

    // Only flip inactive when EVERYTHING was returned; otherwise keep the LP active
    // with its remaining positions intact so it can retry — never strand funds.
    if (failed.length === 0) {
      const [updated] = await db
        .update(lpAccounts)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(lpAccounts.id, mm.lpId))
        .returning()

      return NextResponse.json({ isActive: false, walletAddress: updated.walletAddress, returned, updatedAt: updated.updatedAt })
    }

    return NextResponse.json(
      { isActive: true, walletAddress: lp.walletAddress, returned, failed, partial: true, error: 'Some positions could not be returned and were kept. Please retry.' },
      { status: 207 },
    )
  }
}
