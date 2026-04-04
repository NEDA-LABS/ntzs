'use client'

import { useEffect, useState } from 'react'
import { ethers } from 'ethers'

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_NTZS_CONTRACT_ADDRESS_BASE || '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'
const RPC_URL = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org'

interface TokenBalanceProps {
  walletAddress: string
  compact?: boolean
  className?: string
}

export function TokenBalance({ walletAddress, compact = false, className }: TokenBalanceProps) {
  const [balance, setBalance] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!walletAddress || !CONTRACT_ADDRESS) {
      setLoading(false)
      return
    }

    const fetchBalance = async () => {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL)
        const contract = new ethers.Contract(
          CONTRACT_ADDRESS,
          ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
          provider
        )

        const [rawBalance, decimals] = await Promise.all([
          contract.balanceOf(walletAddress),
          contract.decimals().catch(() => 18),
        ])

        const formatted = ethers.formatUnits(rawBalance, decimals)
        setBalance(formatted)
      } catch (error) {
        console.error('Failed to fetch balance:', error)
        setBalance('0')
      } finally {
        setLoading(false)
      }
    }

    fetchBalance()
    const interval = setInterval(fetchBalance, 30000)
    return () => clearInterval(interval)
  }, [walletAddress])

  const numBalance = parseFloat(balance || '0')
  const usdValue = (numBalance * 0.00039).toFixed(2)

  if (compact) {
    const base = className ?? 'text-sm'
    if (loading) {
      return <p className={`${base} font-bold text-white/50 animate-pulse`}>-- TZS</p>
    }
    return (
      <p className={`${base} font-bold text-white`}>
        {numBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} TZS
      </p>
    )
  }

  if (loading) {
    return (
      <div className="flex items-baseline gap-3">
        <span className="text-5xl font-bold tracking-tight text-white/50 animate-pulse">--</span>
        <span className="text-lg text-zinc-500">TZS</span>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-baseline gap-3">
        <span className="text-5xl font-bold tracking-tight text-white">
          {numBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className="text-lg text-zinc-500">TZS</span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <span className="text-zinc-500">≈ ${usdValue} USD</span>
      </div>
    </>
  )
}
