'use client'

import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import { AnimatePresence, motion } from 'framer-motion'

const RPC_URL = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org'

const TOKENS = {
  NTZS: {
    address: process.env.NEXT_PUBLIC_NTZS_CONTRACT_ADDRESS_BASE || '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688',
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

    const onSwapComplete = () => fetch()
    window.addEventListener('swap:complete', onSwapComplete)

    return () => {
      clearInterval(interval)
      window.removeEventListener('swap:complete', onSwapComplete)
    }
  }, [walletAddress])

  const token = TOKENS[active]
  const raw = parseFloat(balances[active] || '0')
  const formatted = active === 'NTZS'
    ? raw.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : raw.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const usdcBalance = parseFloat(balances.USDC || '0')
  const hasUsdc = usdcBalance > 0
  const subtitle = active === 'NTZS' ? 'Spendable TZS balance' : 'USD stablecoin balance'

  return (
    <div className="space-y-5">
      <div className="inline-flex items-center rounded-full border border-border/40 bg-background/40 p-1 backdrop-blur-xl">
        {(Object.keys(TOKENS) as TokenKey[]).map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setActive(key)}
            className={`relative rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition-colors duration-150 ${
              active === key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80'
            }`}
          >
            {active === key && (
              <motion.span
                layoutId="balance-pill"
                className="absolute inset-0 rounded-full bg-foreground text-background"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {TOKENS[key].label}
              {key === 'USDC' && hasUsdc && active !== 'USDC' && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
              )}
            </span>
          </button>
        ))}
      </div>

      <div>
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-2"
          >
            <p className={`text-4xl font-semibold tracking-tight md:text-5xl ${loading ? 'text-foreground/40 animate-pulse' : 'text-foreground'}`}>
              {loading ? `-- ${token.symbol}` : `${formatted} ${token.symbol}`}
            </p>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </motion.div>
        </AnimatePresence>
        <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          Updated from Base mainnet
        </div>
      </div>
    </div>
  )
}
