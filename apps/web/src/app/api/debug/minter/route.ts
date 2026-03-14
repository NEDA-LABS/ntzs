import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { BASE_RPC_URL, MINTER_PRIVATE_KEY, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  if (!secret || secret !== (process.env.CRON_SECRET || 'debug')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    if (!MINTER_PRIVATE_KEY) {
      return NextResponse.json({ error: 'MINTER_PRIVATE_KEY not set' })
    }
    const wallet = new ethers.Wallet(MINTER_PRIVATE_KEY)
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const token = new ethers.Contract(
      NTZS_CONTRACT_ADDRESS_BASE,
      ['function MINTER_ROLE() view returns (bytes32)', 'function hasRole(bytes32,address) view returns (bool)'],
      provider
    )
    const role = await token.MINTER_ROLE()
    const hasMinter = await token.hasRole(role, wallet.address)

    return NextResponse.json({
      minterAddress: wallet.address,
      hasMinterRole: hasMinter,
      rpcUrl: BASE_RPC_URL.slice(0, 30) + '...',
      contractAddress: NTZS_CONTRACT_ADDRESS_BASE,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) })
  }
}
