import { NextRequest, NextResponse } from 'next/server'
import { eq, inArray, or, sql } from 'drizzle-orm'
import { Contract, JsonRpcProvider, formatUnits } from 'ethers'

import { isAuthorizedCron } from '@/lib/cron-auth'
import { getDb } from '@/lib/db'
import { fxFeeSweeps, lpFills, lpPoolPositions, lpWalletTransactions } from '@ntzs/db'
import { CHAIN_TOKENS, getChainConfig, getChainTokens, type ChainId } from '@/lib/fx/chainConfig'
import { sendFxMail } from '@/lib/fx/mailer'
import { POOL_ALERT_RECIPIENTS } from '@/lib/fx/alert-email'
import { readReconState, reconStateAvailable, writeReconState } from '@/lib/fx/recon-state'
import {
  TRANSFER_TOPIC,
  alertFingerprint,
  chunkBlockRanges,
  dedupeExpected,
  dedupeLogs,
  evaluateInvariant,
  expectedFromFeeSweeps,
  expectedFromFills,
  expectedFromWalletTxs,
  matchTransfers,
  parseTransferLogs,
  topicForAddress,
  type AnomalousTransfer,
  type ExpectedTransfer,
  type RawLog,
  type ReconChainSweep,
  type ReconRunSummary,
  type ReconSweepAnomaly,
  type ReconTokenRow,
} from '@/lib/fx/recon'

export const maxDuration = 60

type Db = ReturnType<typeof getDb>['db']

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

// Drift larger than this (in token units) is flagged. Generous enough to absorb
// rounding dust across many fills, tight enough to catch a real accounting leak.
const TOLERANCE: Record<string, number> = { nTZS: 50, USDC: 0.5, USDT: 0.5 }

// Only scan blocks this far behind the tip so shallow reorgs can't produce
// phantom transfers that a later run would never see again.
const CONFIRMATIONS = 6

function intEnv(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// Alchemy rejects eth_getLogs ranges over 10k blocks.
const GETLOGS_CHUNK = Math.min(intEnv('POOL_RECON_GETLOGS_CHUNK', 9_999), 10_000)
// Per-run scan budget; a long outage catches up at this rate every run.
const MAX_BLOCKS_PER_RUN = intEnv('POOL_RECON_MAX_BLOCKS', 30_000)
// First-ever run (no cursor) starts this far behind the safe tip.
const INITIAL_LOOKBACK = intEnv('POOL_RECON_INITIAL_LOOKBACK_BLOCKS', 30_000)
// While the same condition persists, re-page at most this often.
const ALERT_COOLDOWN_MS = intEnv('POOL_RECON_ALERT_COOLDOWN_MINUTES', 360) * 60_000
const MAX_ANOMALIES_REPORTED = 50

const EXPLORER: Record<string, string> = { base: 'https://basescan.org', bnb: 'https://bscscan.com' }

// Token addresses are unique per chain, so one flat lookup covers both chains.
const DECIMALS_BY_TOKEN: Record<string, number> = {}
const SYMBOL_BY_TOKEN: Record<string, string> = {}
for (const tokens of Object.values(CHAIN_TOKENS)) {
  for (const t of Object.values(tokens)) {
    DECIMALS_BY_TOKEN[t.address.toLowerCase()] = t.decimals
    SYMBOL_BY_TOKEN[t.address.toLowerCase()] = t.symbol
  }
}

// Recorded amounts pass through float math + toFixed before hitting the ledger,
// so allow 1e-4 token units of rounding dust when comparing against raw logs.
function toleranceRaw(tokenAddressLower: string): bigint {
  const decimals = DECIMALS_BY_TOKEN[tokenAddressLower] ?? 18
  return BigInt(10) ** BigInt(Math.max(0, decimals - 4))
}

function reconRecipients(): string[] {
  const env = (process.env.POOL_RECON_ALERT_RECIPIENTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return env.length ? env : POOL_ALERT_RECIPIENTS
}

/** Chains with an RPC configured; the rest are reported as skipped, never fatal. */
function reconChains(): {
  chains: { chain: ChainId; rpcUrl: string; solver: string }[]
  skipped: string[]
} {
  const chains: { chain: ChainId; rpcUrl: string; solver: string }[] = []
  const skipped: string[] = []
  for (const chain of ['base', 'bnb'] as ChainId[]) {
    try {
      const cfg = getChainConfig(chain)
      chains.push({ chain, rpcUrl: cfg.rpcUrl, solver: cfg.solverAddress.toLowerCase() })
    } catch {
      skipped.push(`${chain}: RPC not configured`)
    }
  }
  return { chains, skipped }
}

/**
 * Detector 1 — balance invariant, per token:
 *   claims     = SUM(lp_pool_positions.contributed) on this chain
 *   unsweptFee = SUM(lp_fills.protocol_fee_earned) − SUM(fx_fee_sweeps.amount)
 *   expected   = claims + unsweptFee   vs   onChain = balanceOf(solver)
 * deficit → LP claims aren't fully backed (CRITICAL); surplus → unattributed value.
 */
async function invariantForChain(
  db: Db,
  provider: JsonRpcProvider,
  chain: ChainId,
  solver: string,
): Promise<ReconTokenRow[]> {
  const recordedRows = await db
    .select({
      token: sql<string>`lower(${lpPoolPositions.tokenAddress})`,
      total: sql<string>`coalesce(sum(${lpPoolPositions.contributed}), '0')`,
    })
    .from(lpPoolPositions)
    .where(eq(lpPoolPositions.chain, chain))
    .groupBy(sql`lower(${lpPoolPositions.tokenAddress})`)
  const recordedByAddr = new Map(recordedRows.map((r) => [r.token, parseFloat(r.total)]))

  return Promise.all(
    Object.values(getChainTokens(chain)).map(async (token) => {
      const addr = token.address.toLowerCase()

      // Fee rows are scoped by token address alone — addresses are chain-unique,
      // and cross-chain fills carry the right to-token but a default 'base' chain.
      const [feeEarned] = await db
        .select({ total: sql<string>`coalesce(sum(${lpFills.protocolFeeEarned}), '0')` })
        .from(lpFills)
        .where(sql`lower(${lpFills.toToken}) = ${addr}`)
      const [feeSwept] = await db
        .select({ total: sql<string>`coalesce(sum(${fxFeeSweeps.amount}), '0')` })
        .from(fxFeeSweeps)
        .where(sql`lower(${fxFeeSweeps.tokenAddress}) = ${addr}`)

      const claims = recordedByAddr.get(addr) ?? 0
      const unsweptFee = parseFloat(feeEarned.total) - parseFloat(feeSwept.total)

      const contract = new Contract(token.address, ERC20_ABI, provider)
      const raw: bigint = await contract.balanceOf(solver)
      const onChain = parseFloat(formatUnits(raw, token.decimals))

      const { expected, delta, status } = evaluateInvariant({
        claims,
        unsweptFee,
        onChain,
        tolerance: TOLERANCE[token.symbol] ?? 0,
      })

      const dp = token.decimals === 6 ? 6 : 4
      return {
        chain,
        token: token.symbol,
        tokenAddress: token.address,
        claims: claims.toFixed(dp),
        unsweptFee: unsweptFee.toFixed(dp),
        expected: expected.toFixed(dp),
        onChain: onChain.toFixed(dp),
        delta: delta.toFixed(dp),
        status,
      }
    }),
  )
}

/** Every ledger row that could explain one of the swept tx hashes. */
async function loadExpected(db: Db, hashes: string[]): Promise<ExpectedTransfer[]> {
  const expected: ExpectedTransfer[] = []
  for (let i = 0; i < hashes.length; i += 300) {
    const chunk = hashes.slice(i, i + 300)
    const [fills, walletTxs, sweeps] = await Promise.all([
      db
        .select({
          id: lpFills.id,
          inTxHash: lpFills.inTxHash,
          outTxHash: lpFills.outTxHash,
          fromToken: lpFills.fromToken,
          toToken: lpFills.toToken,
          amountIn: lpFills.amountIn,
          amountOut: lpFills.amountOut,
        })
        .from(lpFills)
        .where(
          or(
            inArray(sql`lower(${lpFills.inTxHash})`, chunk),
            inArray(sql`lower(${lpFills.outTxHash})`, chunk),
          ),
        ),
      db
        .select({
          id: lpWalletTransactions.id,
          type: lpWalletTransactions.type,
          txHash: lpWalletTransactions.txHash,
          tokenAddress: lpWalletTransactions.tokenAddress,
          amount: lpWalletTransactions.amount,
          decimals: lpWalletTransactions.decimals,
        })
        .from(lpWalletTransactions)
        .where(inArray(sql`lower(${lpWalletTransactions.txHash})`, chunk)),
      db
        .select({
          id: fxFeeSweeps.id,
          txHash: fxFeeSweeps.txHash,
          tokenAddress: fxFeeSweeps.tokenAddress,
          amount: fxFeeSweeps.amount,
        })
        .from(fxFeeSweeps)
        .where(inArray(sql`lower(${fxFeeSweeps.txHash})`, chunk)),
    ])
    expected.push(
      ...expectedFromFills(fills, DECIMALS_BY_TOKEN),
      ...expectedFromWalletTxs(walletTxs),
      ...expectedFromFeeSweeps(sweeps, DECIMALS_BY_TOKEN),
    )
  }
  // Collapses the historical double rows in lp_wallet_transactions (same
  // tx_hash, symbol case differs) and any row fetched twice across chunks.
  return dedupeExpected(expected)
}

function toSummaryAnomaly(chain: ChainId, a: AnomalousTransfer): ReconSweepAnomaly {
  return {
    chain,
    txHash: a.log.txHash,
    logIndex: a.log.logIndex,
    blockNumber: a.log.blockNumber,
    direction: a.direction,
    token: SYMBOL_BY_TOKEN[a.log.tokenAddress] ?? a.log.tokenAddress,
    amount: formatUnits(a.log.amountRaw, DECIMALS_BY_TOKEN[a.log.tokenAddress] ?? 18),
    kind: a.kind,
    detail: a.detail,
  }
}

/**
 * Detector 2 — Transfer-log sweep from the persisted per-chain cursor to the
 * safe tip. Every ERC-20 Transfer touching the solver must match a ledger row.
 */
async function sweepChain(
  db: Db,
  provider: JsonRpcProvider,
  chain: ChainId,
  solver: string,
  stateOk: boolean,
): Promise<{ sweep: ReconChainSweep; anomalies: ReconSweepAnomaly[]; newCursor?: number }> {
  if (!stateOk) {
    return {
      sweep: {
        chain,
        fromBlock: 0,
        toBlock: 0,
        transfers: 0,
        matched: 0,
        anomalyCount: 0,
        skipped: 'fx_recon_state missing — apply drizzle/0065_fx_recon_state.sql',
      },
      anomalies: [],
    }
  }

  const safeTip = (await provider.getBlockNumber()) - CONFIRMATIONS
  const cursor = await readReconState<{ lastBlock: number }>(db, `sweep_cursor:${chain}`)
  const fromBlock = cursor ? cursor.lastBlock + 1 : Math.max(0, safeTip - INITIAL_LOOKBACK + 1)
  if (safeTip < fromBlock) {
    return {
      sweep: { chain, fromBlock, toBlock: safeTip, transfers: 0, matched: 0, anomalyCount: 0 },
      anomalies: [],
    }
  }
  const toBlock = Math.min(safeTip, fromBlock + MAX_BLOCKS_PER_RUN - 1)

  const addresses = Object.values(getChainTokens(chain)).map((t) => t.address)
  const solverTopic = topicForAddress(solver)

  const raw: RawLog[] = []
  for (const range of chunkBlockRanges(fromBlock, toBlock, GETLOGS_CHUNK)) {
    // topics arrays AND across positions, so sender/receiver need separate calls.
    const [sent, received] = await Promise.all([
      provider.getLogs({ address: addresses, fromBlock: range.fromBlock, toBlock: range.toBlock, topics: [TRANSFER_TOPIC, solverTopic] }),
      provider.getLogs({ address: addresses, fromBlock: range.fromBlock, toBlock: range.toBlock, topics: [TRANSFER_TOPIC, null, solverTopic] }),
    ])
    raw.push(...sent, ...received)
  }

  const logs = dedupeLogs(parseTransferLogs(raw))
  const expected = await loadExpected(db, [...new Set(logs.map((l) => l.txHash))])
  const { matched, anomalies } = matchTransfers(logs, expected, { solver, toleranceRaw })

  return {
    sweep: {
      chain,
      fromBlock,
      toBlock,
      transfers: logs.length,
      matched: matched.length,
      anomalyCount: anomalies.length,
    },
    anomalies: anomalies.map((a) => toSummaryAnomaly(chain, a)),
    newCursor: toBlock,
  }
}

function buildAlertEmail(input: {
  tokens: ReconTokenRow[]
  deficits: ReconTokenRow[]
  anomalies: ReconSweepAnomaly[]
  anomalyTotal: number
  sweeps: ReconChainSweep[]
  solvers: { chain: ChainId; solver: string }[]
}): { subject: string; html: string } {
  const { tokens, deficits, anomalies, anomalyTotal, sweeps, solvers } = input

  const parts: string[] = []
  if (deficits.length) parts.push(`deficit ${deficits.map((d) => `${d.token} ${d.delta} (${d.chain})`).join(', ')}`)
  if (anomalyTotal) parts.push(`${anomalyTotal} unexplained transfer${anomalyTotal === 1 ? '' : 's'}`)
  const subject = `🚨 SimpleFX solver pool: ${parts.join('; ')}`

  const cell = 'padding:6px 10px;border:1px solid #e5e7eb'
  const tokenRows = tokens
    .map((r) => {
      const bad = r.status === 'deficit'
      return `<tr style="${bad ? 'background:#fef2f2' : ''}">
        <td style="${cell}">${r.chain}</td>
        <td style="${cell}">${r.token}</td>
        <td style="${cell};text-align:right">${r.claims}</td>
        <td style="${cell};text-align:right">${r.unsweptFee}</td>
        <td style="${cell};text-align:right">${r.expected}</td>
        <td style="${cell};text-align:right">${r.onChain}</td>
        <td style="${cell};text-align:right;font-weight:600">${r.delta}</td>
        <td style="${cell};${bad ? 'color:#dc2626;font-weight:700' : r.status === 'surplus' ? 'color:#d97706' : 'color:#16a34a'}">${r.status}</td>
      </tr>`
    })
    .join('')

  const anomalyRows = anomalies
    .map((a) => {
      const explorer = EXPLORER[a.chain]
      const link = explorer ? `<a href="${explorer}/tx/${a.txHash}">${a.txHash}</a>` : a.txHash
      return `<tr style="background:#fef2f2">
        <td style="${cell}">${a.chain}</td>
        <td style="${cell}">${a.blockNumber}</td>
        <td style="${cell}">${a.direction === 'in' ? '→ solver' : 'solver →'}</td>
        <td style="${cell}">${a.token}</td>
        <td style="${cell};text-align:right">${a.amount}</td>
        <td style="${cell}">${a.kind}${a.detail ? ` — ${a.detail}` : ''}</td>
        <td style="${cell};font-family:monospace;font-size:11px">${link}</td>
      </tr>`
    })
    .join('')

  const sweepLine = sweeps
    .map((s) => (s.skipped ? `${s.chain}: ${s.skipped}` : `${s.chain}: blocks ${s.fromBlock}–${s.toBlock}, ${s.transfers} transfers, ${s.anomalyCount} anomalous`))
    .join(' · ')

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111">
      <h2 style="margin:0 0 4px">🚨 SimpleFX solver pool reconciliation</h2>
      <p style="margin:0 0 12px;color:#555"><b>deficit</b> = the solver cannot back all LP claims (the 23 Jul 2026 failure mode);
      <b>unexplained transfer</b> = on-chain value moved through the solver with no matching ledger row.</p>
      <h3 style="margin:16px 0 6px;font-size:14px">Balance invariant (claims + unswept fees vs on-chain)</h3>
      <table style="border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f9fafb">
          <th style="${cell};text-align:left">Chain</th>
          <th style="${cell};text-align:left">Token</th>
          <th style="${cell};text-align:right">LP claims</th>
          <th style="${cell};text-align:right">Unswept fee</th>
          <th style="${cell};text-align:right">Expected</th>
          <th style="${cell};text-align:right">On-chain</th>
          <th style="${cell};text-align:right">Delta</th>
          <th style="${cell};text-align:left">Status</th>
        </tr></thead>
        <tbody>${tokenRows}</tbody>
      </table>
      ${
        anomalies.length
          ? `<h3 style="margin:16px 0 6px;font-size:14px">Unexplained solver transfers</h3>
      <table style="border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f9fafb">
          <th style="${cell};text-align:left">Chain</th>
          <th style="${cell};text-align:left">Block</th>
          <th style="${cell};text-align:left">Direction</th>
          <th style="${cell};text-align:left">Token</th>
          <th style="${cell};text-align:right">Amount</th>
          <th style="${cell};text-align:left">Kind</th>
          <th style="${cell};text-align:left">Tx</th>
        </tr></thead>
        <tbody>${anomalyRows}</tbody>
      </table>
      ${anomalyTotal > anomalies.length ? `<p style="margin:6px 0 0;color:#b91c1c;font-size:12px">…and ${anomalyTotal - anomalies.length} more — see the cron response / backstage.</p>` : ''}`
          : ''
      }
      <p style="margin:14px 0 0;color:#555;font-size:12px">Sweep: ${sweepLine || 'not run'}</p>
      <p style="margin:4px 0 0;color:#555;font-size:12px">Solver: ${solvers.map((s) => `${s.chain} <code>${s.solver}</code>`).join(' · ')} · ${new Date().toISOString()}</p>
    </div>`

  return { subject, html }
}

/**
 * GET /api/cron/fx-pool-reconcile — every 10 minutes.
 *
 * Solver-pool reconciliation for SimpleFX, built after the 23 Jul 2026 incident
 * (two overdrawn fills left the solver 3,055.91 nTZS short of LP claims and it
 * took a manual Transfer-log sweep to find out). Two detectors per chain:
 *
 *   1. Balance invariant (cheap, primary) — LP claims + unswept protocol fees
 *      must be covered by balanceOf(solver). Deficit = CRITICAL.
 *   2. Transfer-log sweep (thorough, secondary) — every ERC-20 Transfer touching
 *      the solver since the persisted cursor must match lp_fills,
 *      lp_wallet_transactions or fx_fee_sweeps. Unexplained = CRITICAL.
 *
 * CRITICAL findings email POOL_RECON_ALERT_RECIPIENTS (fallback: the internal
 * pool-alert list), deduped by fingerprint with a re-page cooldown. The latest
 * summary is persisted for the backstage SimpleFX page. Only writes to
 * fx_recon_state; the ledger itself is never touched.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const { db } = getDb()
  const { chains, skipped: chainsSkipped } = reconChains()
  const stateOk = await reconStateAvailable(db)

  const tokens: ReconTokenRow[] = []
  const sweeps: ReconChainSweep[] = []
  const allAnomalies: ReconSweepAnomaly[] = []
  const cursorWrites: { chain: ChainId; lastBlock: number }[] = []

  for (const c of chains) {
    const provider = new JsonRpcProvider(c.rpcUrl)

    try {
      tokens.push(...(await invariantForChain(db, provider, c.chain, c.solver)))
    } catch (err) {
      chainsSkipped.push(`${c.chain}: invariant check failed — ${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      const result = await sweepChain(db, provider, c.chain, c.solver, stateOk)
      sweeps.push(result.sweep)
      allAnomalies.push(...result.anomalies)
      if (result.newCursor !== undefined) cursorWrites.push({ chain: c.chain, lastBlock: result.newCursor })
    } catch (err) {
      sweeps.push({
        chain: c.chain,
        fromBlock: 0,
        toBlock: 0,
        transfers: 0,
        matched: 0,
        anomalyCount: 0,
        skipped: `sweep failed — ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  const deficits = tokens.filter((t) => t.status === 'deficit')
  const surpluses = tokens.filter((t) => t.status === 'surplus')
  const status: ReconRunSummary['status'] =
    deficits.length || allAnomalies.length ? 'critical' : surpluses.length ? 'info' : 'ok'
  const reportedAnomalies = allAnomalies.slice(0, MAX_ANOMALIES_REPORTED)

  // Alert on CRITICAL, deduped by fingerprint: a new deficit token or a new
  // anomalous tx pages immediately; an unchanged condition re-pages only after
  // the cooldown. A clean run clears the fingerprint.
  let alerted = false
  let alertFailed = false
  if (status === 'critical') {
    const fingerprint = alertFingerprint(deficits, allAnomalies)
    const last = stateOk ? await readReconState<{ fingerprint: string; at: string }>(db, 'last_alert') : null
    const due = !last || last.fingerprint !== fingerprint || Date.now() - Date.parse(last.at) > ALERT_COOLDOWN_MS
    if (due) {
      const { subject, html } = buildAlertEmail({
        tokens,
        deficits,
        anomalies: reportedAnomalies,
        anomalyTotal: allAnomalies.length,
        sweeps,
        solvers: chains.map((c) => ({ chain: c.chain, solver: c.solver })),
      })
      try {
        await sendFxMail(reconRecipients(), subject, html)
        alerted = true
        if (stateOk) await writeReconState(db, 'last_alert', { fingerprint, at: new Date().toISOString() })
      } catch (err) {
        alertFailed = true
        console.error('[fx-pool-reconcile] alert email failed:', err instanceof Error ? err.message : err)
      }
    }
  } else if (stateOk) {
    const last = await readReconState<{ fingerprint: string }>(db, 'last_alert')
    if (last?.fingerprint) await writeReconState(db, 'last_alert', { fingerprint: '', at: new Date().toISOString() })
  }

  // Advance cursors only once any anomalies in the scanned range have been
  // dispatched (or deduped); a failed email leaves the range to be re-swept.
  if (!alertFailed) {
    for (const w of cursorWrites) {
      await writeReconState(db, `sweep_cursor:${w.chain}`, { lastBlock: w.lastBlock })
    }
  }

  const summary: ReconRunSummary = {
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    status,
    tokens,
    sweeps,
    anomalies: reportedAnomalies,
    chainsSkipped,
    alerted,
  }
  if (stateOk) await writeReconState(db, 'last_run', summary)

  return NextResponse.json({ ok: true, stateOk, ...summary })
}
