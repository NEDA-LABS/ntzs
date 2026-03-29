import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'

const ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
] as const

export async function GET(request: NextRequest) {
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const token = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, ABI, provider)

    const totalSupplyWei: bigint = await token.totalSupply()
    const totalSupplyTzs = Number(totalSupplyWei / BigInt(10) ** BigInt(18))

    const addressParam = request.nextUrl.searchParams.get('addresses')
    let walletBalances: Record<string, number> | undefined

    if (addressParam) {
      const addresses = addressParam.split(',').map(a => a.trim()).filter(Boolean)
      walletBalances = {}
      await Promise.all(addresses.map(async (addr) => {
        const bal: bigint = await token.balanceOf(addr)
        walletBalances![addr] = Number(bal / BigInt(10) ** BigInt(18))
      }))
    }

    return NextResponse.json({
      totalSupplyTzs,
      contractAddress: NTZS_CONTRACT_ADDRESS_BASE,
      chain: 'base',
      ...(walletBalances ? { walletBalances } : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ status: 'error', error: message }, { status: 500 })
  }
}
