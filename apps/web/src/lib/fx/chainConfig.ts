import { parseEther } from 'ethers'

export type ChainId = 'base' | 'bnb'

export const CHAIN_TOKENS = {
  base: {
    NTZS: { address: '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688' as `0x${string}`, decimals: 18, symbol: 'nTZS' },
    USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`, decimals: 6,  symbol: 'USDC' },
    USDT: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2' as `0x${string}`, decimals: 6,  symbol: 'USDT' },
  },
  bnb: {
    USDT: { address: '0x55d398326f99059fF775485246999027B3197955' as `0x${string}`, decimals: 18, symbol: 'USDT' },
  },
} as const

export type BaseTokenSymbol = keyof typeof CHAIN_TOKENS.base
export type BnbTokenSymbol  = keyof typeof CHAIN_TOKENS.bnb

export function getChainTokens(chain: ChainId) {
  return CHAIN_TOKENS[chain] as Record<string, { address: `0x${string}`; decimals: number; symbol: string }>
}

export function getChainToken(chain: ChainId, symbol: string) {
  const tokens = getChainTokens(chain)
  const token = tokens[symbol.toUpperCase()]
  if (!token) throw new Error(`Token ${symbol} not found on chain ${chain}`)
  return token
}

export function getChainConfig(chainId: ChainId) {
  if (chainId === 'bnb') {
    const rpcUrl = process.env.BNB_RPC_URL
    if (!rpcUrl) throw new Error('BNB_RPC_URL not configured')
    return {
      rpcUrl,
      solverAddress: (process.env.BNB_SOLVER_ADDRESS ?? process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646') as `0x${string}`,
      solverPrivateKey: (process.env.BNB_SOLVER_PRIVATE_KEY ?? process.env.SOLVER_PRIVATE_KEY) as `0x${string}`,
      relayerKey: (process.env.BNB_RELAYER_PRIVATE_KEY ?? process.env.RELAYER_PRIVATE_KEY) as string | undefined,
      minGas: parseEther('0.0001'), // BNB
      chainName: 'BNB Smart Chain',
    }
  }
  const rpcUrl = process.env.BASE_RPC_URL
  if (!rpcUrl) throw new Error('BASE_RPC_URL not configured')
  return {
    rpcUrl,
    solverAddress: (process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646') as `0x${string}`,
    solverPrivateKey: process.env.SOLVER_PRIVATE_KEY as `0x${string}`,
    relayerKey: (process.env.RELAYER_PRIVATE_KEY ?? process.env.MINTER_PRIVATE_KEY) as string | undefined,
    minGas: parseEther('0.0001'), // ETH
    chainName: 'Base',
  }
}
