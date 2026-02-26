import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { authenticatePartner } from '@/lib/waas/auth'
import { wallets } from '@ntzs/db'

const NTZS_ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
] as const

/**
 * GET /api/v1/reconcile — Compare on-chain totalSupply vs sum of all user balances
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL
  const contractAddress =
    process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.NTZS_CONTRACT_ADDRESS_BASE

  if (!rpcUrl || !contractAddress) {
    return NextResponse.json({ error: 'Blockchain configuration missing' }, { status: 500 })
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const token = new ethers.Contract(contractAddress, NTZS_ABI, provider)

    // Read on-chain total supply
    const totalSupplyWei: bigint = await token.totalSupply()
    const onChainSupplyTzs = Number(totalSupplyWei / (BigInt(10) ** BigInt(18)))

    // Sum all user on-chain balances
    const { db } = getDb()

    const allWallets = await db
      .select({ address: wallets.address })
      .from(wallets)
      .where(sql`${wallets.chain} = 'base' AND ${wallets.address} NOT LIKE '0x_pending_%'`)

    let dbTotalBalanceTzs = 0

    // Batch balance reads (limit concurrency to avoid RPC rate limits)
    const batchSize = 10
    for (let i = 0; i < allWallets.length; i += batchSize) {
      const batch = allWallets.slice(i, i + batchSize)
      const balances = await Promise.all(
        batch.map(async (w) => {
          try {
            const bal: bigint = await token.balanceOf(w.address)
            return Number(bal / (BigInt(10) ** BigInt(18)))
          } catch {
            return 0
          }
        })
      )
      dbTotalBalanceTzs += balances.reduce((sum, b) => sum + b, 0)
    }

    const difference = onChainSupplyTzs - dbTotalBalanceTzs
    const isReconciled = Math.abs(difference) < 1 // Allow < 1 TZS rounding

    return NextResponse.json({
      onChainSupplyTzs,
      dbTotalBalanceTzs,
      difference,
      isReconciled,
      walletsChecked: allWallets.length,
      contractAddress,
      chain: 'base',
    })
  } catch (err) {
    console.error('[v1/reconcile] Reconciliation failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Reconciliation failed' }, { status: 500 })
  }
}
