import { ethers } from 'ethers'
import postgres from 'postgres'

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]

const SOLVER_ADDRESS = process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646'

/**
 * LP Earnings Worker
 *
 * Runs periodically to detect any token balance increase in the solver wallet
 * above the sum of all LP contributed amounts. That delta is "unallocated
 * earnings" from filled orders and is distributed proportionally to active LPs
 * based on their contributed share of that token.
 *
 * This is intentionally conservative: it only allocates positive deltas and
 * never adjusts downward (losses from slippage are absorbed by the pool silently).
 */
export async function processLpEarnings(databaseUrl: string, rpcUrl: string): Promise<void> {
  const pg = postgres(databaseUrl, { max: 2 })
  const provider = new ethers.JsonRpcProvider(rpcUrl)

  try {
    // Find all unique tokens with active LP positions
    const rows = await pg<{ token_address: string; token_symbol: string; decimals: number }[]>`
      SELECT DISTINCT p.token_address, p.token_symbol, p.decimals
      FROM lp_pool_positions p
      INNER JOIN lp_accounts a ON a.id = p.lp_id
      WHERE a.is_active = true
        AND p.contributed::numeric > 0
    `

    for (const { token_address, token_symbol, decimals } of rows) {
      try {
        await allocateEarningsForToken(pg, provider, token_address, token_symbol, decimals)
      } catch (err) {
        console.warn(`[lp-earnings] Error processing ${token_symbol}:`, err instanceof Error ? err.message : err)
      }
    }
  } finally {
    await pg.end({ timeout: 5 })
  }
}

async function allocateEarningsForToken(
  pg: ReturnType<typeof postgres>,
  provider: ethers.JsonRpcProvider,
  tokenAddress: string,
  tokenSymbol: string,
  decimals: number
): Promise<void> {
  // Get solver wallet on-chain balance
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
  const rawBalance: bigint = await contract.balanceOf(SOLVER_ADDRESS)
  const solverBalance = Number(ethers.formatUnits(rawBalance, decimals))

  if (solverBalance <= 0) return

  // Sum all contributed + earned for this token across active LPs
  const [totals] = await pg<{ total_contributed: string; total_earned: string }[]>`
    SELECT
      COALESCE(SUM(p.contributed::numeric), 0)::text AS total_contributed,
      COALESCE(SUM(p.earned::numeric), 0)::text      AS total_earned
    FROM lp_pool_positions p
    INNER JOIN lp_accounts a ON a.id = p.lp_id
    WHERE a.is_active = true
      AND p.token_address = ${tokenAddress}
  `

  const totalContributed = parseFloat(totals.total_contributed ?? '0')
  const totalEarned = parseFloat(totals.total_earned ?? '0')
  const totalTracked = totalContributed + totalEarned

  // Unallocated = solver balance above what we've already accounted for
  const unallocated = solverBalance - totalTracked

  // Only distribute if there's a meaningful unallocated amount (> 0.001 to avoid dust loops)
  const minThreshold = decimals >= 18 ? 0.001 : 0.0001
  if (unallocated <= minThreshold) return

  console.log(`[lp-earnings] ${tokenSymbol}: solver=${solverBalance}, tracked=${totalTracked.toFixed(6)}, unallocated=${unallocated.toFixed(6)}`)

  // Fetch all active LP positions for this token
  const positions = await pg<{
    id: string
    lp_id: string
    contributed: string
    earned: string
  }[]>`
    SELECT p.id, p.lp_id, p.contributed, p.earned
    FROM lp_pool_positions p
    INNER JOIN lp_accounts a ON a.id = p.lp_id
    WHERE a.is_active = true
      AND p.token_address = ${tokenAddress}
      AND p.contributed::numeric > 0
  `

  if (positions.length === 0) return

  // Distribute proportionally by contributed share
  for (const pos of positions) {
    const contributed = parseFloat(pos.contributed)
    const share = contributed / totalContributed
    const lpEarnings = unallocated * share

    if (lpEarnings <= 0) continue

    await pg`
      UPDATE lp_pool_positions
      SET
        earned     = (earned::numeric + ${lpEarnings}::numeric)::text,
        updated_at = now()
      WHERE id = ${pos.id}
    `

    console.log(`[lp-earnings] Allocated ${lpEarnings.toFixed(6)} ${tokenSymbol} to LP ${pos.lp_id} (${(share * 100).toFixed(1)}% share)`)
  }
}
