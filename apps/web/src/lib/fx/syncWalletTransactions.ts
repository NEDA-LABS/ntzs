import { db } from './db'
import { lpWalletTransactions } from '@ntzs/db'
import { and, eq } from 'drizzle-orm'

const NTZS   = '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'
const USDC   = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const SOLVER = '0xf4766439DC70f5B943Cc1918747b408b612ba646'.toLowerCase()
const ZERO   = '0x0000000000000000000000000000000000000000'

const TOKEN_META: Record<string, { sym: string; addr: string; dec: number }> = {
  [NTZS.toLowerCase()]: { sym: 'nTZS', addr: NTZS, dec: 18 },
  [USDC.toLowerCase()]: { sym: 'USDC',  addr: USDC,  dec: 6  },
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
): Promise<AlchemyTransfer[]> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 1, jsonrpc: '2.0', method: 'alchemy_getAssetTransfers',
      params: [{
        [direction]: address,
        contractAddresses: [NTZS, USDC],
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

function classify(tx: AlchemyTransfer, wallet: string): { type: string; source: string } | null {
  const from = tx.from.toLowerCase()
  const to   = tx.to?.toLowerCase() ?? ''
  if (to === wallet && from === ZERO)   return { type: 'deposit',             source: 'mpesa'   }
  if (to === wallet && from === SOLVER) return { type: 'deactivation_return', source: 'system'  }
  if (to === wallet)                    return { type: 'deposit',             source: 'onchain' }
  if (from === wallet && to === SOLVER) return { type: 'activation_sweep',    source: 'system'  }
  if (from === wallet)                  return { type: 'withdrawal',          source: 'onchain' }
  return null
}

/**
 * Pulls all nTZS/USDC on-chain transfers for an LP wallet from Alchemy and
 * inserts any missing records into lp_wallet_transactions.
 * Idempotent: deduplicates by (lp_id, tx_hash, token_address).
 * Non-blocking: errors are swallowed so callers are never interrupted.
 */
export async function syncLpWalletTransactions(lpId: string, walletAddress: string): Promise<void> {
  const rpcUrl = process.env.BASE_RPC_URL
  if (!rpcUrl) return

  try {
    const wallet = walletAddress.toLowerCase()

    const [incoming, outgoing] = await Promise.all([
      fetchTransfers(rpcUrl, 'toAddress', walletAddress),
      fetchTransfers(rpcUrl, 'fromAddress', walletAddress),
    ])

    // Deduplicate by (hash, contractAddress) — same tx can appear in both directions
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
      const meta = TOKEN_META[tx.rawContract?.address?.toLowerCase()]
      if (!meta) continue

      const label = classify(tx, wallet)
      if (!label) continue

      // Skip if already recorded
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
