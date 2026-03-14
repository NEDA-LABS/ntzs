import { NextResponse } from 'next/server'
import { ethers } from 'ethers'

const ABI = ['function totalSupply() view returns (uint256)'] as const

/**
 * GET /api/coingecko/supply/circulating
 *
 * Public endpoint for CoinGecko to fetch the circulating supply of nTZS.
 * For nTZS, circulating supply equals total supply — all minted tokens are in circulation.
 * Returns a plain decimal number (no authentication required).
 * Spec: https://docs.google.com/document/d/1v27QFoQq1SKT3Priq3aqPgB70Xd_PnDzbOCiuoCyixw (Section C)
 */
export async function GET() {
  const rpcUrl = process.env.BASE_RPC_URL
  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE

  if (!rpcUrl || !contractAddress) {
    return new NextResponse('Blockchain configuration missing', { status: 500 })
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const token = new ethers.Contract(contractAddress, ABI, provider)
    const raw: bigint = await token.totalSupply()

    const whole = raw / BigInt(10 ** 18)
    const frac = raw % BigInt(10 ** 18)
    const supply = `${whole}.${frac.toString().padStart(18, '0')}`

    return new NextResponse(supply, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  } catch (err) {
    console.error('[coingecko/supply/circulating]', err instanceof Error ? err.message : err)
    return new NextResponse('Failed to read on-chain supply', { status: 500 })
  }
}
