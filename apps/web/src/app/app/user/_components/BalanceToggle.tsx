'use client'

import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import { AnimatePresence, motion } from 'framer-motion'

const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org'
const BNB_RPC = 'https://bsc-dataseed.binance.org/'

const TOKENS = {
  NTZS: {
    address: process.env.NEXT_PUBLIC_NTZS_CONTRACT_ADDRESS_BASE || '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688',
    decimals: 18,
    symbol: 'TZS',
    label: 'nTZS',
    icon: '/ntzs-icon.svg',
  },
  USDC: {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    symbol: 'USDC',
    label: 'USDC',
    icon: '/usdc-logo.svg',
  },
  USDT: {
    address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', // Base default
    decimals: 6,
    symbol: 'USDT',
    label: 'USDT',
    icon: '/usdt-logo.svg',
  },
} as const

const USDT_CHAINS = {
  base: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2' as const, decimals: 6 },
  bnb:  { address: '0x55d398326f99059fF775485246999027B3197955' as const, decimals: 18 },
}

type TokenKey = keyof typeof TOKENS
type UsdtChain = keyof typeof USDT_CHAINS

type Balances = {
  NTZS: string | null
  USDC: string | null
  USDT_base: string | null
  USDT_bnb: string | null
}

interface BalanceToggleProps {
  walletAddress: string
}

export function BalanceToggle({ walletAddress }: BalanceToggleProps) {
  const [active, setActive] = useState<TokenKey>('NTZS')
  const [usdtChain, setUsdtChain] = useState<UsdtChain>('base')
  const [balances, setBalances] = useState<Balances>({ NTZS: null, USDC: null, USDT_base: null, USDT_bnb: null })
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!walletAddress) return

    const abi = ['function balanceOf(address) view returns (uint256)']
    const baseNetwork = ethers.Network.from(8453)
    const bnbNetwork = ethers.Network.from(56)

    const fetchAll = async () => {
      try {
        const baseProvider = new ethers.JsonRpcProvider(BASE_RPC, baseNetwork, { staticNetwork: baseNetwork })
        const bnbProvider = new ethers.JsonRpcProvider(BNB_RPC, bnbNetwork, { staticNetwork: bnbNetwork })

        const [ntzsRaw, usdcRaw, usdtBaseRaw, usdtBnbRaw] = await Promise.all([
          TOKENS.NTZS.address
            ? new ethers.Contract(TOKENS.NTZS.address, abi, baseProvider).balanceOf(walletAddress, { blockTag: 'latest' })
            : Promise.resolve(BigInt(0)),
          new ethers.Contract(TOKENS.USDC.address, abi, baseProvider).balanceOf(walletAddress, { blockTag: 'latest' }),
          new ethers.Contract(USDT_CHAINS.base.address, abi, baseProvider).balanceOf(walletAddress, { blockTag: 'latest' }),
          new ethers.Contract(USDT_CHAINS.bnb.address, abi, bnbProvider).balanceOf(walletAddress, { blockTag: 'latest' }),
        ])

        setBalances({
          NTZS: ethers.formatUnits(ntzsRaw, TOKENS.NTZS.decimals),
          USDC: ethers.formatUnits(usdcRaw, TOKENS.USDC.decimals),
          USDT_base: ethers.formatUnits(usdtBaseRaw, USDT_CHAINS.base.decimals),
          USDT_bnb: ethers.formatUnits(usdtBnbRaw, USDT_CHAINS.bnb.decimals),
        })
      } catch {
        // keep previous balances on transient RPC errors
      } finally {
        setLoading(false)
      }
    }

    fetchAll()
    const interval = setInterval(fetchAll, 30_000)

    const onUpdate = () => fetchAll()
    window.addEventListener('swap:complete', onUpdate)
    window.addEventListener('deposit:complete', onUpdate)

    return () => {
      clearInterval(interval)
      window.removeEventListener('swap:complete', onUpdate)
      window.removeEventListener('deposit:complete', onUpdate)
    }
  }, [walletAddress])

  const rawBalance = (() => {
    if (active === 'NTZS') return parseFloat(balances.NTZS || '0')
    if (active === 'USDC') return parseFloat(balances.USDC || '0')
    return parseFloat((usdtChain === 'base' ? balances.USDT_base : balances.USDT_bnb) || '0')
  })()

  const formatted = active === 'NTZS'
    ? rawBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : rawBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const token = TOKENS[active]

  const hasUsdc = parseFloat(balances.USDC || '0') > 0
  const hasUsdt = parseFloat(balances.USDT_base || '0') > 0 || parseFloat(balances.USDT_bnb || '0') > 0

  const subtitle = active === 'NTZS'
    ? 'Spendable TZS balance'
    : active === 'USDC'
    ? 'USD stablecoin balance on Base'
    : `USDT balance on ${usdtChain === 'base' ? 'Base' : 'BNB Smart Chain'}`

  const shortAddress = `${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}`

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

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
              <img src={TOKENS[key].icon} alt={`${TOKENS[key].label} icon`} className="h-4 w-4" />
              {TOKENS[key].label}
              {key === 'USDC' && hasUsdc && active !== 'USDC' && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
              )}
              {key === 'USDT' && hasUsdt && active !== 'USDT' && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
              )}
            </span>
          </button>
        ))}
      </div>

      <div>
        <AnimatePresence mode="wait">
          <motion.div
            key={`${active}-${active === 'USDT' ? usdtChain : ''}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-2"
          >
            <p className={`text-4xl font-semibold tracking-tight md:text-5xl ${loading ? 'text-foreground/40 animate-pulse' : 'text-foreground'}`}>
              {loading ? (
                `-- ${token.symbol}`
              ) : (
                <>
                  {formatted}
                  <span className="ml-2 inline-flex items-center gap-1 align-middle">
                    <img src={token.icon} alt={`${token.label} icon`} className="h-5 w-5" />
                    {token.symbol}
                  </span>
                </>
              )}
            </p>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </motion.div>
        </AnimatePresence>

        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {active === 'USDT' ? (
            <div className="inline-flex items-center rounded-full border border-border/40 bg-background/35 p-0.5 backdrop-blur-xl">
              {(['base', 'bnb'] as UsdtChain[]).map(chain => (
                <button
                  key={chain}
                  type="button"
                  onClick={() => setUsdtChain(chain)}
                  className={`relative rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] transition-colors duration-150 ${
                    usdtChain === chain ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/70'
                  }`}
                >
                  {usdtChain === chain && (
                    <motion.span
                      layoutId="chain-pill"
                      className="absolute inset-0 rounded-full bg-foreground/15"
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    />
                  )}
                  <span className="relative flex items-center gap-1">
                    <img
                      src={chain === 'base' ? '/base.svg' : '/bnb.svg'}
                      alt={chain}
                      className="h-3 w-3"
                    />
                    {chain === 'base' ? 'Base' : 'BNB'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background/35 px-2.5 py-1 backdrop-blur-xl">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Base
            </span>
          )}

          <button
            type="button"
            onClick={copyAddress}
            className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/35 px-3 py-1.5 font-mono text-foreground/85 backdrop-blur-xl hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring"
            title="Copy address"
          >
            {shortAddress}
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {copied && <span className="text-[10px] text-emerald-400">Copied</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
