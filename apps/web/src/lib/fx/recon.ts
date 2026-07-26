/**
 * Pure logic for the solver-pool reconciliation cron (/api/cron/fx-pool-reconcile).
 *
 * Two independent detectors, both born out of the 23 Jul 2026 incident where two
 * overdrawn fills left the solver 3,055.91 nTZS short of total LP claims and the
 * gap sat undetected until a manual on-chain sweep:
 *
 *   1. Balance invariant — SUM(lp_pool_positions.contributed) + unswept protocol
 *      fees must be backed by the solver's on-chain balance. A deficit means the
 *      solver cannot pay every claim (CRITICAL); a surplus is value nobody's
 *      ledger accounts for (fees accrue there until swept — INFO).
 *
 *   2. Transfer-log sweep — every ERC-20 Transfer that touches the solver wallet
 *      must be explained by a ledger row (lp_fills, lp_wallet_transactions or
 *      fx_fee_sweeps). An unexplained transfer is money moving outside the books.
 *
 * Everything in this file is side-effect free (no DB, no RPC) so the matching
 * rules are unit-testable; the cron route owns IO and feeds plain rows in.
 */

/** keccak256("Transfer(address,address,uint256)") — ERC-20 Transfer topic0. */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export type ReconDirection = 'in' | 'out'

/** A decoded ERC-20 Transfer that touches the solver wallet. */
export interface TransferLog {
  txHash: string
  logIndex: number
  tokenAddress: string
  from: string
  to: string
  amountRaw: bigint
  blockNumber: number
}

/** The subset of an eth_getLogs entry the sweep needs (ethers Log or raw RPC). */
export interface RawLog {
  address: string
  topics: readonly string[]
  data: string
  transactionHash: string
  index?: number
  logIndex?: number | string
  blockNumber: number | string
}

/** A transfer the ledger says should exist on-chain. */
export interface ExpectedTransfer {
  /** 'lp_fill:in' | 'lp_fill:out' | 'lp_wallet:<type>' | 'fee_sweep' */
  source: string
  refId: string
  txHash: string
  /** Relative to the solver wallet. 'either' = row may not involve the solver at all. */
  direction: ReconDirection | 'either'
  tokenAddress: string | null
  amountRaw: bigint | null
}

export interface MatchedTransfer {
  log: TransferLog
  direction: ReconDirection
  source: string
  refId: string
}

export interface AnomalousTransfer {
  log: TransferLog
  direction: ReconDirection
  /** 'unmatched' = no ledger row shares the tx hash; 'mismatched' = a row shares the hash but token/direction/amount disagree. */
  kind: 'unmatched' | 'mismatched'
  detail?: string
}

export interface ReconMatchResult {
  matched: MatchedTransfer[]
  anomalies: AnomalousTransfer[]
}

/** Left-pad an address into a 32-byte log topic. */
export function topicForAddress(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{40}$/.test(hex)) throw new Error(`Invalid address for topic: ${address}`)
  return `0x${'0'.repeat(24)}${hex}`
}

/**
 * Convert a decimal string (DB numeric, scale up to 18) into raw token units,
 * rounding half-up on the first digit beyond `decimals`. Returns null when the
 * string is not a plain decimal number. Never throws — ledger rows recorded with
 * more precision than the token (e.g. scale-18 numerics for a 6-decimals token)
 * must not crash the sweep the way ethers' parseUnits would.
 */
export function toRawAmount(value: string, decimals: number): bigint | null {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.trim())
  if (!m) return null
  const sign = m[1] === '-' ? BigInt(-1) : BigInt(1)
  const frac = (m[3] ?? '').slice(0, decimals).padEnd(decimals, '0')
  let raw = BigInt(m[2]) * BigInt(10) ** BigInt(decimals) + BigInt(frac === '' ? '0' : frac)
  const firstDropped = (m[3] ?? '').charCodeAt(decimals)
  if (firstDropped >= 53 && firstDropped <= 57) raw += BigInt(1) // '5'..'9' → round up
  return sign * raw
}

/** Inclusive block ranges of at most `chunkSize` blocks (Alchemy caps getLogs at 10k). */
export function chunkBlockRanges(
  fromBlock: number,
  toBlock: number,
  chunkSize: number,
): { fromBlock: number; toBlock: number }[] {
  if (chunkSize < 1) throw new Error('chunkSize must be >= 1')
  const ranges: { fromBlock: number; toBlock: number }[] = []
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    ranges.push({ fromBlock: start, toBlock: Math.min(start + chunkSize - 1, toBlock) })
  }
  return ranges
}

/** Decode raw logs into TransferLogs, skipping anything that isn't an ERC-20 Transfer. */
export function parseTransferLogs(rawLogs: RawLog[]): TransferLog[] {
  const out: TransferLog[] = []
  for (const log of rawLogs) {
    if (log.topics.length !== 3 || log.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue
    const data = log.data === '0x' || log.data === '' ? '0x0' : log.data
    let amountRaw: bigint
    try {
      amountRaw = BigInt(data)
    } catch {
      continue
    }
    const logIndex = Number(log.index ?? log.logIndex ?? 0)
    out.push({
      txHash: log.transactionHash.toLowerCase(),
      logIndex,
      tokenAddress: log.address.toLowerCase(),
      from: `0x${log.topics[1].slice(-40).toLowerCase()}`,
      to: `0x${log.topics[2].slice(-40).toLowerCase()}`,
      amountRaw,
      blockNumber: Number(log.blockNumber),
    })
  }
  return out
}

/** Drop duplicate logs (the sent/received getLogs pair both return solver self-transfers). */
export function dedupeLogs(logs: TransferLog[]): TransferLog[] {
  const seen = new Set<string>()
  return logs.filter((log) => {
    const key = `${log.txHash}:${log.logIndex}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface FillRow {
  id: string
  inTxHash: string
  outTxHash: string
  fromToken: string
  toToken: string
  amountIn: string
  amountOut: string
}

export interface WalletTxRow {
  id: string
  type: string
  txHash: string | null
  tokenAddress: string
  amount: string
  decimals: number
}

export interface FeeSweepRow {
  id: string
  txHash: string
  tokenAddress: string
  amount: string
}

/**
 * Direction of each lp_wallet_transactions type relative to the SOLVER wallet.
 * deposit/withdrawal move between the LP wallet and the outside world — they
 * normally never touch the solver, so they only ever match permissively.
 * Unknown types are treated the same way rather than raising false alarms.
 */
const WALLET_TX_DIRECTION: Record<string, ReconDirection | 'either'> = {
  activation_sweep: 'in', // LP wallet → solver
  reconciliation_topup: 'in', // manual make-whole → solver
  deactivation_return: 'out', // solver → LP wallet
  deposit: 'either',
  withdrawal: 'either',
}

/** Each fill settles as two transfers: taker → solver (in-leg) and solver → taker (out-leg). */
export function expectedFromFills(
  rows: FillRow[],
  decimalsByToken: Record<string, number>,
): ExpectedTransfer[] {
  const out: ExpectedTransfer[] = []
  for (const row of rows) {
    const fromToken = row.fromToken.toLowerCase()
    const toToken = row.toToken.toLowerCase()
    const inDec = decimalsByToken[fromToken]
    const outDec = decimalsByToken[toToken]
    out.push({
      source: 'lp_fill:in',
      refId: row.id,
      txHash: row.inTxHash.toLowerCase(),
      direction: 'in',
      tokenAddress: fromToken,
      amountRaw: inDec === undefined ? null : toRawAmount(row.amountIn, inDec),
    })
    out.push({
      source: 'lp_fill:out',
      refId: row.id,
      txHash: row.outTxHash.toLowerCase(),
      direction: 'out',
      tokenAddress: toToken,
      amountRaw: outDec === undefined ? null : toRawAmount(row.amountOut, outDec),
    })
  }
  return out
}

export function expectedFromWalletTxs(rows: WalletTxRow[]): ExpectedTransfer[] {
  const out: ExpectedTransfer[] = []
  for (const row of rows) {
    if (!row.txHash) continue
    out.push({
      source: `lp_wallet:${row.type}`,
      refId: row.id,
      txHash: row.txHash.toLowerCase(),
      direction: WALLET_TX_DIRECTION[row.type] ?? 'either',
      tokenAddress: row.tokenAddress.toLowerCase(),
      amountRaw: toRawAmount(row.amount, row.decimals),
    })
  }
  return out
}

export function expectedFromFeeSweeps(
  rows: FeeSweepRow[],
  decimalsByToken: Record<string, number>,
): ExpectedTransfer[] {
  return rows.map((row) => {
    const token = row.tokenAddress.toLowerCase()
    const dec = decimalsByToken[token]
    return {
      source: 'fee_sweep',
      refId: row.id,
      txHash: row.txHash.toLowerCase(),
      direction: 'out' as const,
      tokenAddress: token,
      amountRaw: dec === undefined ? null : toRawAmount(row.amount, dec),
    }
  })
}

/**
 * Collapse duplicate expected entries. lp_wallet_transactions carries historical
 * DOUBLE rows per sweep/return (same tx_hash, token symbol case differs) — they
 * reduce to identical (source, hash, direction, token, amount) tuples here, so
 * the dedupe both fixes that data wart and stays safe for clean rows.
 */
export function dedupeExpected(expected: ExpectedTransfer[]): ExpectedTransfer[] {
  const seen = new Set<string>()
  return expected.filter((e) => {
    const key = `${e.source}|${e.txHash}|${e.direction}|${e.tokenAddress}|${e.amountRaw?.toString() ?? 'null'}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface MatchOptions {
  /** Solver wallet address (any casing). */
  solver: string
  /** Absolute tolerance in raw units per token address; defaults to exact match. */
  toleranceRaw?: (tokenAddressLower: string) => bigint
}

/**
 * Explain every solver transfer with a ledger row, or flag it.
 *
 * A log matches an expected entry when they share the tx hash AND the entry's
 * token/direction/amount (where known) agree. Entries are consumed as they
 * match so one ledger row cannot explain two on-chain transfers.
 */
export function matchTransfers(
  logs: TransferLog[],
  expected: ExpectedTransfer[],
  options: MatchOptions,
): ReconMatchResult {
  const solver = options.solver.toLowerCase()
  const tolerance = options.toleranceRaw ?? (() => BigInt(0))

  const byHash = new Map<string, { entry: ExpectedTransfer; used: boolean }[]>()
  for (const entry of expected) {
    const list = byHash.get(entry.txHash) ?? []
    list.push({ entry, used: false })
    byHash.set(entry.txHash, list)
  }

  const matched: MatchedTransfer[] = []
  const anomalies: AnomalousTransfer[] = []

  for (const log of logs) {
    const direction: ReconDirection = log.to === solver ? 'in' : 'out'
    const candidates = byHash.get(log.txHash) ?? []

    if (candidates.length === 0) {
      anomalies.push({ log, direction, kind: 'unmatched' })
      continue
    }

    let hit: { entry: ExpectedTransfer; used: boolean } | undefined
    const reasons: string[] = []
    for (const candidate of candidates) {
      if (candidate.used) {
        reasons.push(`${candidate.entry.source}#${candidate.entry.refId}: already matched another transfer in this tx`)
        continue
      }
      const { entry } = candidate
      if (entry.tokenAddress !== null && entry.tokenAddress !== log.tokenAddress) {
        reasons.push(`${entry.source}#${entry.refId}: token ${entry.tokenAddress} ≠ ${log.tokenAddress}`)
        continue
      }
      if (entry.direction !== 'either' && entry.direction !== direction) {
        reasons.push(`${entry.source}#${entry.refId}: direction ${entry.direction} ≠ ${direction}`)
        continue
      }
      if (entry.amountRaw !== null) {
        const diff = log.amountRaw > entry.amountRaw ? log.amountRaw - entry.amountRaw : entry.amountRaw - log.amountRaw
        if (diff > tolerance(log.tokenAddress)) {
          reasons.push(`${entry.source}#${entry.refId}: amount ${entry.amountRaw} ≠ ${log.amountRaw} (raw)`)
          continue
        }
      }
      hit = candidate
      break
    }

    if (hit) {
      hit.used = true
      matched.push({ log, direction, source: hit.entry.source, refId: hit.entry.refId })
    } else {
      anomalies.push({ log, direction, kind: 'mismatched', detail: reasons.join('; ') })
    }
  }

  return { matched, anomalies }
}

export interface InvariantResult {
  expected: number
  delta: number
  status: 'ok' | 'deficit' | 'surplus'
}

/**
 * The pool invariant. `claims` = SUM(lp_pool_positions.contributed);
 * `unsweptFee` = protocol fees earned but not yet swept to treasury (they sit in
 * the solver wallet until the fee-sweep cron moves them). A deficit means LP
 * claims are not fully backed — the exact failure mode of the 23 Jul incident,
 * where the pool paid takers in full while the shorted LP's debit clamped at 0.
 */
export function evaluateInvariant(input: {
  claims: number
  unsweptFee: number
  onChain: number
  tolerance: number
}): InvariantResult {
  const expected = input.claims + input.unsweptFee
  const delta = input.onChain - expected
  const status = delta < -input.tolerance ? 'deficit' : delta > input.tolerance ? 'surplus' : 'ok'
  return { expected, delta, status }
}

/**
 * Stable identity of an alert condition, used to dedupe emails across runs.
 * Deliberately magnitude-free for deficits (chain:token only) so a slowly
 * drifting delta doesn't page every 10 minutes — the cooldown re-pages while
 * the condition persists; any NEW deficit token or anomalous tx pages at once.
 */
export function alertFingerprint(
  deficits: { chain: string; token: string }[],
  anomalies: { txHash: string; logIndex: number }[],
): string {
  const d = deficits.map((x) => `${x.chain}:${x.token}`).sort()
  const a = anomalies.map((x) => `${x.txHash}:${x.logIndex}`).sort()
  return `deficits=${d.join(',')}|anomalies=${a.join(',')}`
}

// ---------------------------------------------------------------------------
// Run summary persisted to fx_recon_state ('last_run') and shown in backstage.
// ---------------------------------------------------------------------------

export interface ReconTokenRow {
  chain: string
  token: string
  tokenAddress: string
  claims: string
  unsweptFee: string
  expected: string
  onChain: string
  delta: string
  status: 'ok' | 'deficit' | 'surplus'
}

export interface ReconSweepAnomaly {
  chain: string
  txHash: string
  logIndex: number
  blockNumber: number
  direction: ReconDirection
  token: string
  amount: string
  kind: 'unmatched' | 'mismatched'
  detail?: string
}

export interface ReconChainSweep {
  chain: string
  fromBlock: number
  toBlock: number
  transfers: number
  matched: number
  anomalyCount: number
  /** Set when the sweep did not run (RPC missing/failed, state table absent). */
  skipped?: string
}

export interface ReconRunSummary {
  ranAt: string
  durationMs: number
  status: 'ok' | 'info' | 'critical'
  tokens: ReconTokenRow[]
  sweeps: ReconChainSweep[]
  /** Capped list for display/email; anomalyCount on each sweep is the true total. */
  anomalies: ReconSweepAnomaly[]
  chainsSkipped: string[]
  alerted: boolean
}
