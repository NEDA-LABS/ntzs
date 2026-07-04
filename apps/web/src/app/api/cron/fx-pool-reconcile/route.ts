import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { sql } from 'drizzle-orm'
import { JsonRpcProvider, Contract, formatUnits } from 'ethers'

import { getDb } from '@/lib/db'
import { lpPoolPositions, lpFills, fxFeeSweeps } from '@ntzs/db'
import { BASE_RPC_URL } from '@/lib/env'
import { sendPoolAlertEmail } from '@/lib/fx/alert-email'

const SOLVER_ADDRESS = (process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646') as string

export const maxDuration = 60

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

// Tokens that make up the shared solver pool on Base.
const POOL_TOKENS = [
  { symbol: 'nTZS', address: '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688', decimals: 18 },
  { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  { symbol: 'USDT', address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
]

// Drift larger than this (in token units) is flagged. Generous enough to absorb
// rounding dust across many fills, tight enough to catch a real accounting leak.
const TOLERANCE: Record<string, number> = { nTZS: 50, USDC: 0.5, USDT: 0.5 }

/**
 * GET /api/cron/fx-pool-reconcile
 *
 * Read-only health check for the SimpleFX LP pool. For each pool token it compares
 * what the ledger says the solver should hold against what it actually holds:
 *
 *   recorded      = SUM(lp_pool_positions.contributed)            (all LP claims)
 *   unsweptFee    = SUM(lp_fills.protocol_fee_earned)
 *                     − SUM(fx_fee_sweeps.amount)                 (platform's pending cut)
 *   expected      = recorded + unsweptFee                         (what solver should hold)
 *   onChain       = balanceOf(solver)                             (what it does hold)
 *   delta         = onChain − expected
 *
 * delta ≈ 0  → healthy. delta < 0 → solver can't back all claims (a leak — LPs may be
 * unable to fully deactivate). delta ≫ 0 → solver holds value not attributed to any
 * position (unrecorded inflow). Either way the row is flagged `drift`.
 *
 * Never writes — safe to run on a schedule or hit manually with the cron secret.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { db } = getDb()
  const provider = new JsonRpcProvider(BASE_RPC_URL)

  // recorded contributed per token (across every LP), base chain.
  const recordedRows = await db
    .select({
      token: sql<string>`lower(${lpPoolPositions.tokenAddress})`,
      total: sql<string>`coalesce(sum(${lpPoolPositions.contributed}), '0')`,
    })
    .from(lpPoolPositions)
    .where(sql`${lpPoolPositions.chain} = 'base'`)
    .groupBy(sql`lower(${lpPoolPositions.tokenAddress})`)
  const recordedByAddr = new Map(recordedRows.map((r) => [r.token, parseFloat(r.total)]))

  const results = await Promise.all(
    POOL_TOKENS.map(async (token) => {
      const addr = token.address.toLowerCase()

      const [feeEarned] = await db
        .select({ total: sql<string>`coalesce(sum(${lpFills.protocolFeeEarned}), '0')` })
        .from(lpFills)
        .where(sql`lower(${lpFills.toToken}) = ${addr}`)
      const [feeSwept] = await db
        .select({ total: sql<string>`coalesce(sum(${fxFeeSweeps.amount}), '0')` })
        .from(fxFeeSweeps)
        .where(sql`lower(${fxFeeSweeps.tokenAddress}) = ${addr}`)

      const recorded = recordedByAddr.get(addr) ?? 0
      const unsweptFee = parseFloat(feeEarned.total) - parseFloat(feeSwept.total)
      const expected = recorded + unsweptFee

      const contract = new Contract(token.address, ERC20_ABI, provider)
      const raw: bigint = await contract.balanceOf(SOLVER_ADDRESS)
      const onChain = parseFloat(formatUnits(raw, token.decimals))

      const delta = onChain - expected
      const tolerance = TOLERANCE[token.symbol] ?? 0
      const status = delta < -tolerance ? 'short' : delta > tolerance ? 'surplus' : 'ok'

      return {
        token: token.symbol,
        recorded: recorded.toFixed(token.decimals === 6 ? 6 : 4),
        unsweptFee: unsweptFee.toFixed(token.decimals === 6 ? 6 : 4),
        expected: expected.toFixed(token.decimals === 6 ? 6 : 4),
        onChain: onChain.toFixed(token.decimals === 6 ? 6 : 4),
        delta: delta.toFixed(token.decimals === 6 ? 6 : 4),
        status,
      }
    }),
  )

  const healthy = results.every((r) => r.status === 'ok')

  // Alert ops when the ledger and the on-chain solver balance disagree beyond
  // tolerance. Wrapped so a mailer failure never breaks the health response.
  if (!healthy) {
    const offenders = results
      .filter((r) => r.status !== 'ok')
      .map((r) => `${r.token} (${r.status} ${r.delta})`)
      .join(', ')
    const rows = results
      .map((r) => {
        const bad = r.status !== 'ok'
        return `<tr style="${bad ? 'background:#fef2f2' : ''}">
          <td style="padding:6px 10px;border:1px solid #e5e7eb">${r.token}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">${r.recorded}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">${r.unsweptFee}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">${r.expected}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">${r.onChain}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;font-weight:600">${r.delta}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;${bad ? 'color:#dc2626;font-weight:700' : 'color:#16a34a'}">${r.status}</td>
        </tr>`
      })
      .join('')
    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111">
        <h2 style="margin:0 0 4px">⚠️ SimpleFX LP pool drift detected</h2>
        <p style="margin:0 0 12px;color:#555">The recorded ledger no longer matches the on-chain solver balance.
        <b>short</b> = solver can't back all LP claims (a leak); <b>surplus</b> = value held but not attributed to any position.</p>
        <table style="border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f9fafb">
            <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left">Token</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">Recorded</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">Unswept fee</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">Expected</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">On-chain</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">Delta</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left">Status</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin:12px 0 0;color:#555;font-size:12px">Solver <code>${SOLVER_ADDRESS}</code> · ${new Date().toISOString()}</p>
      </div>`
    try {
      await sendPoolAlertEmail(`⚠️ SimpleFX LP pool drift: ${offenders}`, html)
    } catch (err) {
      console.error('[fx-pool-reconcile] failed to send alert email:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ ok: true, healthy, solver: SOLVER_ADDRESS, checkedAt: new Date().toISOString(), results })
}
