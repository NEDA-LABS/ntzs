import { db } from './db'
import { lpWalletTransactions } from '@ntzs/db'
import { and, eq } from 'drizzle-orm'
import { getChainConfig, type ChainId } from './chainConfig'

// Base token addresses
const BASE_NTZS = '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const BASE_USDT = '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2'
// BNB token addresses
const BNB_USDT  = '0x55d398326f99059fF775485246999027B3197955'

const ZERO = '0x0000000000000000000000000000000000000000'

type TokenMeta = Record<string, { sym: string; addr: string; dec: number }>

const BASE_TOKEN_META: TokenMeta = {
  [BASE_NTZS.toLowerCase()]: { sym: 'nTZS', addr: BASE_NTZS, dec: 18 },
  [BASE_USDC.toLowerCase()]: { sym: 'USDC', addr: BASE_USDC, dec: 6  },
  [BASE_USDT.toLowerCase()]: { sym: 'USDT', addr: BASE_USDT, dec: 6  },
}

const BNB_TOKEN_META: TokenMeta = {
  [BNB_USDT.toLowerCase()]: { sym: 'USDT', addr: BNB_USDT, dec: 18 },
}

const CHAIN_META: Record<ChainId, { tokenMeta: TokenMeta; contracts: string[] }> = {
  base: {
    tokenMeta: BASE_TOKEN_META,
    contracts: [BASE_NTZS, BASE_USDC, BASE_USDT],
  },
  bnb: {
    tokenMeta: BNB_TOKEN_META,
    contracts: [BNB_USDT],
  },
}

interface AlchemyTransfer {
  hash: string
  from: string
  to: string | null
  value: number | null
  rawContract: { address: string }
  metadata: { blockTimestamp: string }
}

async function fetchTransfers(
  rpcUrl: string,
  direction: 'toAddress' | 'fromAddress',
  address: string,
  contractAddresses: string[],
): Promise<AlchemyTransfer[]> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 1, jsonrpc: '2.0', method: 'alchemy_getAssetTransfers',
      params: [{
        [direction]: address,
        contractAddresses,
        category: ['erc20'],
        withMetadata: true,
        order: 'asc',
        maxCount: '0x3e8',
      }],
    }),
  })
  const json = await res.json()
  return (json.result?.transfers ?? []) as AlchemyTransfer[]
}

function classify(tx: AlchemyTransfer, wallet: string, solverAddress: string): { type: string; source: string } | null {
  const from   = tx.from.toLowerCase()
  const to     = tx.to?.toLowerCase() ?? ''
  const solver = solverAddress.toLowerCase()
  if (to === wallet && from === ZERO)   return { type: 'deposit',             source: 'mpesa'   }
  if (to === wallet && from === solver) return { type: 'deactivation_return', source: 'system'  }
  if (to === wallet)                    return { type: 'deposit',             source: 'onchain' }
  if (from === wallet && to === solver) return { type: 'activation_sweep',    source: 'system'  }
  if (from === wallet)                  return { type: 'withdrawal',          source: 'onchain' }
  return null
}

/**
 * Pulls on-chain ERC-20 transfers for an LP wallet from Alchemy and
 * inserts any missing records into lp_wallet_transactions.
 * Idempotent: deduplicates by (lp_id, tx_hash, token_address).
 * Non-blocking: errors are swallowed so callers are never interrupted.
 */
export async function syncLpWalletTransactions(
  lpId: string,
  walletAddress: string,
  chain: ChainId = 'base',
): Promise<void> {
  let cfg: ReturnType<typeof getChainConfig>
  try {
    cfg = getChainConfig(chain)
  } catch {
    return
  }

  const { tokenMeta, contracts } = CHAIN_META[chain]

  try {
    const wallet = walletAddress.toLowerCase()

    const [incoming, outgoing] = await Promise.all([
      fetchTransfers(cfg.rpcUrl, 'toAddress', walletAddress, contracts),
      fetchTransfers(cfg.rpcUrl, 'fromAddress', walletAddress, contracts),
    ])

    const seen = new Set<string>()
    const transfers = [...incoming, ...outgoing]
      .sort((a, b) => a.metadata.blockTimestamp.localeCompare(b.metadata.blockTimestamp))
      .filter(tx => {
        const key = `${tx.hash}:${tx.rawContract?.address?.toLowerCase()}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

    for (const tx of transfers) {
      const meta = tokenMeta[tx.rawContract?.address?.toLowerCase()]
      if (!meta) continue

      const label = classify(tx, wallet, cfg.solverAddress)
      if (!label) continue

      const existing = await db
        .select({ id: lpWalletTransactions.id })
        .from(lpWalletTransactions)
        .where(and(
          eq(lpWalletTransactions.lpId, lpId),
          eq(lpWalletTransactions.txHash, tx.hash),
          eq(lpWalletTransactions.tokenAddress, meta.addr),
        ))
        .limit(1)

      if (existing.length > 0) continue

      await db.insert(lpWalletTransactions).values({
        lpId,
        chain,
        type:         label.type,
        source:       label.source,
        tokenAddress: meta.addr,
        tokenSymbol:  meta.sym,
        decimals:     meta.dec,
        amount:       (tx.value ?? 0).toString(),
        txHash:       tx.hash,
        createdAt:    new Date(tx.metadata.blockTimestamp),
      })
    }
  } catch (err) {
    console.error('[syncLpWalletTransactions]', err)
  }
}
