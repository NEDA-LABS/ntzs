'use client'

import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import { AnimatePresence, motion } from 'framer-motion'

const RPC_URL = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org'

const TOKENS = {
  NTZS: {
    address: process.env.NEXT_PUBLIC_NTZS_CONTRACT_ADDRESS_BASE || '',
    decimals: 18,
    symbol: 'TZS',
    label: 'nTZS',
  },
  USDC: {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    symbol: 'USDC',
    label: 'USDC',
  },
} as const

type TokenKey = keyof typeof TOKENS

interface BalanceToggleProps {
  walletAddress: string
}

export function BalanceToggle({ walletAddress }: BalanceToggleProps) {
  const [active, setActive] = useState<TokenKey>('NTZS')
  const [balances, setBalances] = useState<Record<TokenKey, string | null>>({ NTZS: null, USDC: null })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!walletAddress) return

    const fetch = async () => {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL)
        const abi = ['function balanceOf(address) view returns (uint256)']

        const [ntzsRaw, usdcRaw] = await Promise.all([
          TOKENS.NTZS.address
            ? new ethers.Contract(TOKENS.NTZS.address, abi, provider).balanceOf(walletAddress)
            : Promise.resolve(BigInt(0)),
          new ethers.Contract(TOKENS.USDC.address, abi, provider).balanceOf(walletAddress),
        ])

        setBalances({
          NTZS: ethers.formatUnits(ntzsRaw, TOKENS.NTZS.decimals),
          USDC: ethers.formatUnits(usdcRaw, TOKENS.USDC.decimals),
        })
      } catch {
        setBalances({ NTZS: '0', USDC: '0' })
      } finally {
        setLoading(false)
      }
    }

    fetch()
    const interval = setInterval(fetch, 30_000)
    return () => clearInterval(interval)
  }, [walletAddress])

  const token = TOKENS[active]
  const raw = parseFloat(balances[active] || '0')
  const formatted = active === 'NTZS'
    ? raw.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : raw.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const usdcBalance = parseFloat(balances.USDC || '0')
  const hasUsdc = usdcBalance > 0

  return (
    <div className="flex flex-col items-end gap-2">
      {/* Toggle pill */}
      <div className="flex items-center rounded-xl bg-black/30 p-0.5 ring-1 ring-white/[0.08]">
        {(Object.keys(TOKENS) as TokenKey[]).map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setActive(key)}
            className={`relative px-2.5 py-1 rounded-[10px] text-[11px] font-semibold transition-colors duration-150 ${
              active === key ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {active === key && (
              <motion.span
                layoutId="balance-pill"
                className="absolute inset-0 rounded-[10px] bg-blue-600/30 ring-1 ring-blue-500/30"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative">
              {TOKENS[key].label}
              {key === 'USDC' && hasUsdc && active !== 'USDC' && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Balance display */}
      <div className="text-right">
        <AnimatePresence mode="wait">
          <motion.p
            key={active}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className={`text-sm font-bold ${loading ? 'text-white/40 animate-pulse' : 'text-white'}`}
          >
            {loading ? `-- ${token.symbol}` : `${formatted} ${token.symbol}`}
          </motion.p>
        </AnimatePresence>
        <p className="text-[10px] font-medium uppercase tracking-wide text-blue-400 mt-0.5">
          Balance
        </p>
      </div>
    </div>
  )
}
