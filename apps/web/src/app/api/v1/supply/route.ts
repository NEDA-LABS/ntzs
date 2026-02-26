import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { authenticatePartner } from '@/lib/waas/auth'

const NTZS_SUPPLY_ABI = ['function totalSupply() view returns (uint256)'] as const

/**
 * GET /api/v1/supply — Get on-chain totalSupply of nTZS
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
    const token = new ethers.Contract(contractAddress, NTZS_SUPPLY_ABI, provider)
    const totalSupplyWei: bigint = await token.totalSupply()
    const totalSupplyTzs = Number(totalSupplyWei / (BigInt(10) ** BigInt(18)))

    return NextResponse.json({
      totalSupplyTzs,
      contractAddress,
      chain: 'base',
    })
  } catch (err) {
    console.error('[v1/supply] Failed to read totalSupply:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to read on-chain supply' }, { status: 500 })
  }
}
