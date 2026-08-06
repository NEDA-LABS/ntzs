import crypto from 'crypto'
import { ethers } from 'ethers'
import { and, desc, eq, inArray, isNull, isNotNull, notInArray, or, sql as dsql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { attestations, burnRequests, depositRequests, orphanPayments, reserveStatements } from '@ntzs/db'
import * as snippe from '@/lib/psp/snippe'
import * as azampay from '@/lib/psp/azampay'
import * as selcom from '@/lib/psp/selcom'
import { sendEmail } from '@/lib/email'
import { POOL_ALERT_RECIPIENTS } from '@/lib/fx/alert-email'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import { computeAnnex, errorChainIncludes, type AttestationAnnex, type ReservePot } from '@/lib/attestation-math'

/**
 * Daily reserve attestation — BoT sandbox Parameter 7 + 16.
 *
 * v2: the (a)–(d) figures submitted to the Bank of Tanzania are unchanged, but
 * the report now
 *   1. sums EVERY reserve pot (Snippe API + AzamPay + Selcom when configured +
 *      govt securities), each labeled with its trust class (api/book/env);
 *   2. reconciles the raw deviation down to an ADJUSTED coverage figure by
 *      netting obligations computed from our own ledger (burned-but-unpaid,
 *      unminted fees, orphans, paid-but-unminted) — see attestation-math.ts;
 *   3. NEVER attests a fabricated reading. If the chain or a pot cannot be
 *      read, there are two outcomes and no third:
 *        - the best available substitute is used and the attestation goes out
 *          QUALIFIED, naming the source and the date the figure was true. In
 *          order of preference: the provider's OWN statement, entered by an
 *          operator (`statement` — current, custodian-issued); else our last
 *          verified reading, carried forward (`stale`). A provider outage is
 *          not a reserve deficiency, and dropping the pot would report a peg
 *          breach that did not happen;
 *        - anything else (chain unreadable, nothing to substitute, or the
 *          substitute is older than ATTESTATION_MAX_STALE_DAYS) sends an
 *          INCOMPLETE alert and persists no row (re-run via
 *          POST /api/admin/attestation once resolved).
 *
 * The hard rule stands: nTZS outstanding must never exceed the TZS reserve.
 */

// TZS reserve held as government securities (T-bills). Cash-only in the current
// sandbox phase → 0; set ATTESTATION_GOVT_SECURITIES_TZS once T-bills are held.
const govtSecuritiesTzs = () => parseFloat(process.env.ATTESTATION_GOVT_SECURITIES_TZS ?? '0') || 0

function recipients(): string[] {
  const env = (process.env.ATTESTATION_RECIPIENTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  return env.length ? env : POOL_ALERT_RECIPIENTS
}

/** Ops-only audience for plumbing alerts (INCOMPLETE readings). The regulator
 * list (ATTESTATION_RECIPIENTS) receives attestations and nothing else — an
 * internal read failure must never surface to BoT. */
function internalRecipients(): string[] {
  const env = (process.env.ATTESTATION_INTERNAL_RECIPIENTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  return env.length ? env : POOL_ALERT_RECIPIENTS
}

/** One short human line per failure — full detail goes to server logs only.
 * Never let raw driver errors (SQL text, hosts) into an email body. */
function sanitizeFailure(label: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[attestation] ${label}:`, msg)
  const firstLine = msg.split('\n')[0].replace(/Failed query:[\s\S]*/i, 'database query error')
  return `${label}: ${firstLine.slice(0, 140)}`
}

/** EAT (UTC+3, no DST) calendar date as YYYY-MM-DD. */
export function eatDate(d = new Date()): string {
  return new Date(d.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10)
}

export interface AttestationReport {
  reportDate: string
  ntzsCirculation: number
  tzsCustodialReserve: number
  tzsGovtSecurities: number
  reserveTotal: number
  deviationPct: number
  fullyBacked: boolean
  withinKpi: boolean
  blockNumber: number | null
  supplySource: string
  reserveSource: string
  reportHash: string
  generatedAt: string
  annex: AttestationAnnex
  /** Pots not read live today. Non-empty = the attestation is QUALIFIED.
   *  'statement' — the provider issued the figure, an operator entered it.
   *  'carried_forward' — our own last verified reading, reused. */
  staleSources: Array<{ key: string; label: string; asOf: string; kind: 'statement' | 'carried_forward' }>
}

export interface IncompleteAttestation {
  status: 'incomplete'
  reportDate: string
  failures: string[]
  /** Everything that DID read — so an incomplete run still shows the reserve
   * position ("backed at ~X%, one source down") instead of a bare error wall. */
  partial: {
    supplyTzs: number | null
    pots: ReservePot[]
    /** gross pots / supply when both sides read — provisional, NOT attested. */
    provisionalCoveragePct: number | null
  }
  generatedAt: string
}

async function readChain(): Promise<{ ok: boolean; supply: number; block: number | null; error?: string }> {
  if (!NTZS_CONTRACT_ADDRESS_BASE) return { ok: false, supply: 0, block: null, error: 'NTZS_CONTRACT_ADDRESS_BASE not configured' }
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const contract = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, ['function totalSupply() view returns (uint256)'], provider)
    const [supply, block] = await Promise.all([
      contract.totalSupply(),
      provider.getBlockNumber().catch(() => null),
    ])
    return { ok: true, supply: Number(ethers.formatUnits(supply, 18)), block }
  } catch (e) {
    return { ok: false, supply: 0, block: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Mobile providers whose cash lands in a pot this report counts. 'selcom'
 * joins only when a Selcom rail flag is on (enum value requires drizzle/0061). */
function countedMobileProviders(): ('snippe' | 'azampay' | 'selcom')[] {
  const selcomOn =
    process.env.SELCOM_COLLECTIONS_ENABLED === 'true' || process.env.SELCOM_W2B_ENABLED === 'true'
  return selcomOn ? ['snippe', 'azampay', 'selcom'] : ['snippe', 'azampay']
}

// ─── Reserve pots ────────────────────────────────────────────────────────────

interface PotRead {
  pot?: ReservePot
  failure?: string
}

/** Labels for pots reconstructed from a statement or a snapshot, where the
 *  live reader never ran to supply one. */
const POT_LABELS: Record<string, string> = {
  snippe: 'Snippe settled balance',
  azampay: 'AzamPay balance',
  selcom: 'Selcom custodial balance',
}

/**
 * How long a carried-forward balance may still stand in for a live reading.
 *
 * Past this, a snapshot stops being evidence and becomes a guess: money can
 * move at the provider without us seeing it, and the longer we cannot look the
 * less the last figure means. Reverting to INCOMPLETE at that point is the
 * honest outcome — it puts a human back in the loop rather than quietly
 * attesting to a number nobody has verified in a fortnight.
 */
const maxStaleDays = () => parseFloat(process.env.ATTESTATION_MAX_STALE_DAYS ?? '7') || 7

/**
 * The last VERIFIED reading of a pot, from the most recent attestation that
 * actually read it live.
 *
 * Only `source: 'api'` rows qualify. A previously-stale figure must never be
 * re-carried, or one unreadable day would propagate forward indefinitely and
 * the reading would age without ever tripping the staleness limit.
 */
async function lastKnownPot(key: string): Promise<ReservePot | null> {
  try {
    const { db } = getDb()
    const rows = await db
      .select({ annex: attestations.annex })
      .from(attestations)
      .orderBy(desc(attestations.reportDate))
      .limit(30)
    for (const row of rows) {
      const pots = (row.annex as AttestationAnnex | null)?.pots
      if (!Array.isArray(pots)) continue
      const hit = pots.find(
        (p) => p?.key === key && p?.source === 'api' && Number.isFinite(Number(p?.amountTzs))
      )
      if (hit) return hit
    }
  } catch (e) {
    console.error('[attestation] snapshot lookup failed:', e instanceof Error ? e.message : e)
  }
  return null
}

/**
 * The provider's own latest statement of a pot, entered by an operator.
 *
 * When an API goes away but the provider keeps telling us what we hold — a
 * daily CSV, a portal export — that figure beats carrying yesterday's reading
 * forward on every axis that matters: it is current, and it comes from the
 * custodian rather than from our memory of them. A bank statement is the
 * oldest form of reserve evidence there is.
 *
 * It is still not an API read, because a human typed it, so it qualifies the
 * attestation and ages out on the same clock. Ordered by the STATEMENT's date,
 * then by entry time so a correction filed later for the same date wins.
 */
async function latestStatementPot(key: string, label: string): Promise<ReservePot | null> {
  try {
    const { db } = getDb()
    const [row] = await db
      .select({
        amountTzs: reserveStatements.amountTzs,
        asOf: reserveStatements.asOf,
        reference: reserveStatements.reference,
      })
      .from(reserveStatements)
      .where(eq(reserveStatements.potKey, key))
      .orderBy(desc(reserveStatements.asOf), desc(reserveStatements.createdAt))
      .limit(1)
    if (!row) return null

    const amount = Number(row.amountTzs)
    if (!Number.isFinite(amount)) return null

    return {
      key,
      label,
      source: 'statement',
      amountTzs: amount,
      // The statement's own date. Entering Tuesday's statement on Thursday must
      // not make it look like Thursday's balance.
      asOf: new Date(row.asOf).toISOString(),
      note: `Provider statement${row.reference ? ` ${row.reference}` : ''}, entered by an operator — API unavailable`,
    }
  } catch (e) {
    // The table arrives with 0077; until then there simply are no statements.
    if (!errorChainIncludes(e, /does not exist|42P01/i)) {
      console.error('[attestation] statement lookup failed:', e instanceof Error ? e.message : e)
    }
  }
  return null
}

/**
 * Carry the last verified balance forward when a live read fails.
 *
 * A provider outage is not a reserve deficiency, but the arithmetic cannot
 * tell the difference: drop an unreadable pot and the report shows the reserve
 * collapsing, which reads as a broken peg and is simply false. Substituting
 * the last verified figure keeps the coverage number true to the money that
 * exists, and marking it `stale` keeps the report honest about what we could
 * and could not verify today. Both halves are required — either alone is a
 * lie in one direction or the other.
 */
async function fallbackToSnapshot(key: string, label: string, failure: string): Promise<PotRead> {
  const limitDays = maxStaleDays()
  const withinLimit = (iso: string) => {
    const ageDays = (Date.now() - Date.parse(iso)) / 86_400_000
    return Number.isFinite(ageDays) && ageDays <= limitDays
  }

  // A statement the provider issued beats our memory of their API.
  const statement = await latestStatementPot(key, label)
  if (statement && withinLimit(statement.asOf)) return { pot: statement }

  const snapshot = await lastKnownPot(key)
  if (!snapshot) return { failure: `${failure} — no previous verified reading to carry forward` }

  const ageDays = (Date.now() - Date.parse(snapshot.asOf)) / 86_400_000
  const limit = maxStaleDays()
  if (!Number.isFinite(ageDays) || ageDays > limit) {
    return {
      failure: `${failure} — last verified reading is ${Math.round(ageDays)} days old, beyond the ${limit}-day carry-forward limit`,
    }
  }

  return {
    pot: {
      ...snapshot,
      source: 'stale',
      // asOf deliberately keeps the ORIGINAL reading time. Stamping it "now"
      // would erase the very fact the reader needs.
      note: `Last verified reading, carried forward — live read failed (${failure})`,
    },
  }
}

async function readSnippePot(): Promise<PotRead> {
  try {
    const bal = await snippe.getBalance()
    return {
      pot: {
        key: 'snippe',
        label: 'Snippe settled balance',
        source: 'api',
        amountTzs: Number(bal.available) || 0,
        asOf: new Date().toISOString(),
      },
    }
  } catch (e) {
    return { failure: sanitizeFailure('Snippe balance read', e) }
  }
}

/**
 * AzamPay collections pot.
 *
 * ATTESTATION_AZAMPAY_MODE:
 *   'book' (default) — derived from our ledger: confirmed AzamPay deposits
 *     minus ATTESTATION_AZAMPAY_SETTLED_TZS (manual offset for any settlement
 *     withdrawn from AzamPay so far). Labeled book-derived: it cannot see
 *     AzamPay's own fee deductions, so the difference between this line and
 *     AzamPay's dashboard balance belongs in the residual until 'api' mode.
 *   'api' — live GET /disbursement/checkbalance (flip once AzamPay confirms
 *     the endpoint covers the collection balance AND our static egress IP is
 *     whitelisted; from non-whitelisted egress it fails and the report goes
 *     INCOMPLETE rather than lying).
 *   'off' — pot omitted entirely.
 */
async function readAzamPayPot(): Promise<PotRead> {
  const mode = process.env.ATTESTATION_AZAMPAY_MODE ?? 'book'
  if (mode === 'off') return {}

  if (mode === 'api') {
    try {
      const bal = await azampay.getBalance()
      return {
        pot: {
          key: 'azampay',
          label: 'AzamPay balance',
          source: 'api',
          amountTzs: Number(bal.available) || 0,
          asOf: new Date().toISOString(),
        },
      }
    } catch (e) {
      return { failure: sanitizeFailure('AzamPay balance read', e) }
    }
  }

  try {
    const { db } = getDb()
    const [row] = await db
      .select({ total: dsql<string>`coalesce(sum(${depositRequests.amountTzs}), 0)` })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.paymentProvider, 'azampay'),
          inArray(depositRequests.status, ['mint_pending', 'mint_requires_safe', 'mint_processing', 'mint_failed', 'minted'])
        )
      )
    const settled = parseFloat(process.env.ATTESTATION_AZAMPAY_SETTLED_TZS ?? '0') || 0
    const amount = Math.max(0, Number(row?.total ?? 0) - settled)
    return {
      pot: {
        key: 'azampay',
        label: 'AzamPay collections (awaiting settlement)',
        source: 'book',
        amountTzs: amount,
        asOf: new Date().toISOString(),
        note: 'derived from our ledger of confirmed AzamPay deposits — not bank-verified; gross of AzamPay fees',
      },
    }
  } catch (e) {
    return { failure: sanitizeFailure('AzamPay book balance query', e) }
  }
}

function selcomConfigured(): boolean {
  return Boolean(process.env.SELCOM_API_KEY && process.env.SELCOM_PRIVATE_KEY && process.env.SELCOM_ACCOUNT_NUMBER)
}

async function readSelcomPot(): Promise<PotRead> {
  if (!selcomConfigured()) return {} // pot joins the report the day credentials land
  try {
    const bal = await selcom.getBalance()
    return {
      pot: {
        key: 'selcom',
        label: 'Selcom custodial balance',
        source: 'api',
        amountTzs: Number(bal.available) || 0,
        asOf: new Date().toISOString(),
      },
    }
  } catch (e) {
    // Key-config diagnostics (lengths/fingerprint only, never material) so a
    // paste problem is identifiable from the backstage failure line alone.
    return { failure: `${sanitizeFailure('Selcom balance read', e)} · ${selcom.selcomKeyDiagnostics()}` }
  }
}

/**
 * The ONE definition of the reserve position — pot list + read failures.
 * The attestation, the backstage minting reserve card and the oversight
 * portal all consume THIS, so no surface can disagree with the number the
 * regulator receives. Pot-to-pot treasury moves (e.g. Snippe → Selcom) are
 * therefore total-neutral on every display simultaneously.
 */
export async function readReservePots(): Promise<{ pots: ReservePot[]; failures: string[] }> {
  // A failed read falls back to the last verified figure before it is called a
  // failure, so a provider outage degrades the report's CONFIDENCE rather than
  // its arithmetic. Only when nothing usable can be carried forward does the
  // run go INCOMPLETE.
  const withFallback = async (key: string, read: () => Promise<PotRead>): Promise<PotRead> => {
    const first = await read()
    if (!first.failure) return first
    return fallbackToSnapshot(key, POT_LABELS[key] ?? key, first.failure)
  }

  const [snippePot, azamPot, selcomPot] = await Promise.all([
    withFallback('snippe', readSnippePot),
    withFallback('azampay', readAzamPayPot),
    withFallback('selcom', readSelcomPot),
  ])
  const failures: string[] = []
  for (const r of [snippePot, azamPot, selcomPot]) if (r.failure) failures.push(r.failure)

  const pots: ReservePot[] = [snippePot.pot, azamPot.pot, selcomPot.pot].filter(
    (p): p is ReservePot => Boolean(p)
  )
  const govt = govtSecuritiesTzs()
  if (govt > 0) {
    pots.push({
      key: 'govt_securities',
      label: 'Government securities (T-bills)',
      source: 'env',
      amountTzs: govt,
      asOf: new Date().toISOString(),
    })
  }
  return { pots, failures }
}

// ─── Obligation nettings (our own ledger) ────────────────────────────────────

async function readNettings() {
  const { db } = getDb()

  // Burned on-chain, cash leg not yet out of the pots. 'completed' = cash left;
  // 'reverted' = tokens re-minted (balanced again); everything else — pending,
  // failed, reconcile_required, reverting, or never attempted — still holds the
  // user's cash. Fees already re-minted for those rows are netted out (their
  // supply came back).
  const [burnRow] = await db
    .select({
      gross: dsql<string>`coalesce(sum(${burnRequests.amountTzs}), 0)`,
      remintedFees: dsql<string>`coalesce(sum(coalesce(${burnRequests.platformFeeTzs}, 0)) filter (where ${burnRequests.feeTxHash} is not null), 0)`,
      remintedNeda: dsql<string>`coalesce(sum(coalesce(${burnRequests.nedaFeeTzs}, 0)) filter (where ${burnRequests.nedaFeeTxHash} is not null), 0)`,
    })
    .from(burnRequests)
    .where(
      and(
        eq(burnRequests.status, 'burned'),
        or(isNull(burnRequests.payoutStatus), notInArray(burnRequests.payoutStatus, ['completed', 'reverted']))
      )
    )
  const burnedUnpaidTzs = Math.max(
    0,
    Number(burnRow?.gross ?? 0) - Number(burnRow?.remintedFees ?? 0) - Number(burnRow?.remintedNeda ?? 0)
  )

  // Fees on COMPLETED burns that were never re-minted to treasury: the fee cash
  // stayed in the pots but its supply never came back.
  const [feeRow] = await db
    .select({
      platform: dsql<string>`coalesce(sum(coalesce(${burnRequests.platformFeeTzs}, 0)) filter (where ${burnRequests.feeTxHash} is null), 0)`,
      neda: dsql<string>`coalesce(sum(coalesce(${burnRequests.nedaFeeTzs}, 0)) filter (where ${burnRequests.nedaFeeTxHash} is null), 0)`,
    })
    .from(burnRequests)
    .where(and(eq(burnRequests.status, 'burned'), eq(burnRequests.payoutStatus, 'completed')))
  const feesUnmintedTzs = Number(feeRow?.platform ?? 0) + Number(feeRow?.neda ?? 0)

  // Cash that reached a PSP with no attributed deposit (pending manual review).
  // The orphan ledger ships in drizzle/0060 — if that migration is not applied
  // yet the table is missing, which is a KNOWN deployment state, not a reading
  // failure: count 0 with a caveat note instead of aborting the attestation.
  let orphanUnmatchedTzs = 0
  const notes: string[] = []
  try {
    const [orphanRow] = await db
      .select({ total: dsql<string>`coalesce(sum(${orphanPayments.amountTzs}), 0)` })
      .from(orphanPayments)
      .where(and(eq(orphanPayments.status, 'unmatched'), eq(orphanPayments.currency, 'TZS')))
    orphanUnmatchedTzs = Number(orphanRow?.total ?? 0)
  } catch (e) {
    // Match through the CAUSE CHAIN — drizzle's outer message is only the SQL
    // text; the "relation does not exist" reason lives in e.cause (the miss
    // that blocked the 2026-07-23 morning run).
    if (errorChainIncludes(e, /does not exist|42P01|undefined_table/i)) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[attestation] orphan_payments table missing (apply drizzle/0060); counting 0:', msg.split('\n')[0])
      notes.push('Unmatched-credit netting counted as 0 — orphan ledger not yet provisioned (drizzle/0060 pending).')
    } else {
      throw e
    }
  }

  // Fiat confirmed in a counted pot, tokens not yet minted (mint owed).
  const [unmintedRow] = await db
    .select({ total: dsql<string>`coalesce(sum(${depositRequests.amountTzs}), 0)` })
    .from(depositRequests)
    .where(
      and(
        inArray(depositRequests.status, ['mint_pending', 'mint_requires_safe', 'mint_processing', 'mint_failed']),
        inArray(depositRequests.paymentProvider, countedMobileProviders()),
        isNotNull(depositRequests.fiatConfirmedAt)
      )
    )
  const paidUnmintedTzs = Number(unmintedRow?.total ?? 0)

  return { burnedUnpaidTzs, feesUnmintedTzs, orphanUnmatchedTzs, paidUnmintedTzs, notes }
}

// ─── Compute ─────────────────────────────────────────────────────────────────

/** Compute the attestation figures with no persistence — used by preview + cron.
 * Returns an IncompleteAttestation instead of numbers when any configured
 * source cannot be read: a reading we could not verify is never attested. */
export async function computeAttestation(): Promise<AttestationReport | IncompleteAttestation> {
  const reportDate = eatDate()
  const [chain, potsRead] = await Promise.all([readChain(), readReservePots()])

  const failures: string[] = []
  if (!chain.ok) failures.push(sanitizeFailure('Chain supply read', chain.error))
  failures.push(...potsRead.failures)

  let nettingsRead
  try {
    nettingsRead = await readNettings()
  } catch (e) {
    failures.push(sanitizeFailure('Obligation ledger queries', e))
  }

  const pots = potsRead.pots
  const govt = pots.find((p) => p.key === 'govt_securities')?.amountTzs ?? 0

  if (failures.length > 0 || !nettingsRead) {
    // Incomplete — but never a bare error wall: carry everything that DID
    // read so humans still see the reserve position at a glance.
    const grossRead = pots.reduce((s, p) => s + p.amountTzs, 0)
    return {
      status: 'incomplete',
      reportDate,
      failures,
      partial: {
        supplyTzs: chain.ok ? chain.supply : null,
        pots,
        provisionalCoveragePct:
          chain.ok && chain.supply > 0 && pots.length > 0
            ? Math.round((grossRead / chain.supply) * 1000000) / 10000
            : null,
      },
      generatedAt: new Date().toISOString(),
    }
  }
  const { notes, ...nettings } = nettingsRead

  // A carried-forward pot qualifies the attestation. Say so in the annex, in
  // the words a reader needs: which source, as at when, and why.
  const unverifiedPots = pots.filter((p) => p.source === 'stale' || p.source === 'statement')
  const annexNotes = [
    ...(notes ?? []),
    ...unverifiedPots.map((p) =>
      p.source === 'statement'
        ? `QUALIFIED: ${p.label} is taken from the provider's own statement as at ${p.asOf}, entered by an operator — the provider's API could not be read for this report.`
        : `QUALIFIED: ${p.label} is our last verified reading, as at ${p.asOf} — the provider could not be read for this report. The balance is held at the provider; it is not verified as at today.`
    ),
  ]

  const annex = computeAnnex({ pots, nettings, totalSupplyTzs: chain.supply, notes: annexNotes })

  const ntzsCirculation = chain.supply
  const tzsCustodialReserve = annex.grossReservesTzs - govt
  const reserveTotal = annex.grossReservesTzs
  const deviationPct = annex.rawDeviationPct
  const fullyBacked = reserveTotal >= ntzsCirculation
  const withinKpi = fullyBacked // peg intact while reserves cover supply; over-backing is safe

  const core = {
    reportDate,
    ntzsCirculation,
    tzsCustodialReserve,
    tzsGovtSecurities: govt,
    reserveTotal,
    deviationPct: +deviationPct.toFixed(6),
    fullyBacked,
    withinKpi,
    blockNumber: chain.block,
    supplySource: `Base Mainnet · ${NTZS_CONTRACT_ADDRESS_BASE ?? 'n/a'} · totalSupply()`,
    reserveSource: pots.map((p) => `${p.label} [${p.source}]`).join(' + '),
    /** Sources carried forward rather than read today — the attestation is
     *  qualified whenever this is non-empty. */
    staleSources: unverifiedPots.map((p) => ({
      key: p.key,
      label: p.label,
      asOf: p.asOf,
      kind: p.source === 'statement' ? ('statement' as const) : ('carried_forward' as const),
    })),
  }
  const reportHash = crypto.createHash('sha256').update(JSON.stringify({ ...core, annex })).digest('hex')
  return { ...core, reportHash, generatedAt: new Date().toISOString(), annex }
}

export function isIncomplete(r: AttestationReport | IncompleteAttestation): r is IncompleteAttestation {
  return (r as IncompleteAttestation).status === 'incomplete'
}

// ─── Email ───────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

function row(label: string, value: string): string {
  return `<tr><td style="padding:8px 12px;border:1px solid #e5e7eb;color:#374151">${label}</td><td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;font-weight:600;color:#111827">${value}</td></tr>`
}

function annexHtml(a: AttestationAnnex, deltaLine: string): string {
  const sourceTag: Record<string, string> = {
    api: 'API-verified',
    book: 'book-derived',
    env: 'declared',
  }
  const potRows = a.pots
    .map((p) =>
      row(
        `${p.label} <span style="color:#6b7280;font-weight:400">[${sourceTag[p.source]}]</span>${p.note ? `<br><span style=\"font-size:11px;color:#9ca3af\">${p.note}</span>` : ''}`,
        'TZS ' + fmt(p.amountTzs)
      )
    )
    .join('')
  const n = a.nettings
  return `
    <h3 style="margin:20px 0 6px;font-size:14px">Annex A — Reserve composition</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      ${potRows}
      ${row('<b>Gross reserves</b>', '<b>TZS ' + fmt(a.grossReservesTzs) + '</b>')}
    </table>
    <h3 style="margin:20px 0 6px;font-size:14px">Annex B — Reconciliation to 1:1</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      ${row('Gross reserves', 'TZS ' + fmt(a.grossReservesTzs))}
      ${row('− Burned, payout not yet executed', 'TZS ' + fmt(n.burnedUnpaidTzs))}
      ${row('− Fee income not re-minted (protocol-owned, non-backing)', 'TZS ' + fmt(n.feesUnmintedTzs))}
      ${row('− Unmatched orphan credits (pending review)', 'TZS ' + fmt(n.orphanUnmatchedTzs))}
      ${row('<b>Backing reserves</b>', '<b>TZS ' + fmt(a.backingReservesTzs) + '</b>')}
      ${row('Circulating supply', fmt(a.totalSupplyTzs) + ' nTZS')}
      ${row('+ Paid, mint pending (tokens owed)', 'TZS ' + fmt(n.paidUnmintedTzs))}
      ${row('<b>Effective obligations</b>', '<b>TZS ' + fmt(a.effectiveObligationsTzs) + '</b>')}
      ${row('<b>Adjusted coverage</b>', `<b>${a.adjustedCoveragePct.toFixed(4)} %</b>`)}
      ${row('Unexplained residual', `${a.residualPct >= 0 ? '+' : ''}${a.residualPct.toFixed(4)} %`)}
    </table>
    ${
      a.notes && a.notes.length > 0
        ? `<p style="font-size:11px;color:#b45309;margin:8px 0 0">${a.notes.map((n) => `⚠ ${n}`).join('<br>')}</p>`
        : ''
    }
    <p style="font-size:11px;color:#6b7280;margin:8px 0 0">
      Adjusted coverage nets obligations already accrued against the reserves that hold their cash;
      100.0000% means every shilling of deviation is attributed. The residual carries the PSP fee
      spread and any opening float — a stable residual is expected, a drifting one is investigated.
      ${deltaLine}
    </p>`
}

/**
 * The attestation email. `includeAnnex` controls whether the reconciliation
 * annex (adjusted coverage, residual) is included:
 *  - regulator copy: classic (a)–(d) format only, until the residual is
 *    understood and stable — promote via ATTESTATION_ANNEX_TO_REGULATOR=true.
 *  - internal copy: always the full annex.
 */
function reportEmailHtml(r: AttestationReport, deltaLine: string, includeAnnex: boolean): string {
  const color = r.fullyBacked ? '#059669' : '#dc2626'
  const status = r.fullyBacked ? 'FULLY BACKED — 1:1 peg maintained' : '⚠️ UNDER-BACKED — PEG BREACH'
  const adjustedLine = includeAnnex
    ? `<p style="margin:0 0 16px;font-size:12px;color:#374151">Adjusted coverage after accrued obligations: <b>${r.annex.adjustedCoveragePct.toFixed(4)}%</b> · residual ${r.annex.residualPct >= 0 ? '+' : ''}${r.annex.residualPct.toFixed(4)}%</p>`
    : '<span style="display:block;margin:0 0 12px"></span>'
  // A qualification the reader has to scroll for is not a qualification. It
  // sits directly under the headline status, before any figure.
  const qualifiedBanner = r.staleSources.length
    ? `<p style="padding:10px 12px;border-radius:6px;background:#d977061a;color:#92400e;font-size:12px;margin:0 0 12px;line-height:1.5">
        <b>⚠️ QUALIFIED READING.</b> ${r.staleSources
          .map((sSrc) =>
          sSrc.kind === 'statement'
            ? `<b>${sSrc.label}</b> could not be read over the provider's API; the figure below is taken from the provider's own statement as at <b>${sSrc.asOf}</b>, entered by an operator.`
            : `<b>${sSrc.label}</b> could not be read for this report; the figure below is our last verified reading, as at <b>${sSrc.asOf}</b>.`
        )
          .join(' ')}
        The balance is held at the provider and no reserve deficiency is implied, but it is <b>not verified as at today</b>.
       </p>`
    : ''
  return `
  <div style="font-family:ui-monospace,Menlo,monospace;max-width:640px;margin:0 auto;color:#111827">
    <p style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#6b7280;margin:0">Bank of Tanzania · Sandbox Ref. LD.170/515/02/1254</p>
    <h2 style="margin:4px 0 2px">nTZS Daily Reserve Attestation</h2>
    <p style="margin:0 0 16px;color:#6b7280">Report date (EAT): <b>${r.reportDate}</b> · Parameter 7 &amp; 16</p>
    <p style="display:inline-block;padding:6px 12px;border-radius:6px;background:${color}1a;color:${color};font-weight:700;margin:0 0 4px">${status}</p>
    ${qualifiedBanner}
    ${adjustedLine}
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      ${row('(a) Total nTZS in circulation', fmt(r.ntzsCirculation) + ' nTZS')}
      ${row('(b) TZS held in custodial reserve', 'TZS ' + fmt(r.tzsCustodialReserve))}
      ${row('(c) TZS in government securities', 'TZS ' + fmt(r.tzsGovtSecurities))}
      ${row('Total TZS reserve', 'TZS ' + fmt(r.reserveTotal))}
      ${row('(d) Deviation from 1:1 ratio (target 0.00%)', r.deviationPct.toFixed(4) + ' %')}
    </table>
    <p style="font-size:12px;color:#6b7280;margin:16px 0 4px">
      The nTZS exchange rate is fixed at 1.00 TZS by the mint/redeem protocol. The figure above is the
      reserve-coverage deviation; a positive value means reserves exceed circulating supply (over-backed, safe).
    </p>
    ${includeAnnex ? annexHtml(r.annex, deltaLine) : ''}
    <table style="border-collapse:collapse;width:100%;font-size:11px;color:#6b7280;margin-top:16px">
      ${row('Supply source', r.supplySource)}
      ${row('Reserve source', r.reserveSource)}
      ${row('Base block height', r.blockNumber != null ? String(r.blockNumber) : 'n/a')}
      ${row('Report hash (SHA-256)', r.reportHash)}
      ${row('Generated at', r.generatedAt)}
    </table>
  </div>`
}

function incompleteEmailHtml(inc: IncompleteAttestation): string {
  return `
  <div style="font-family:ui-monospace,Menlo,monospace;max-width:640px;margin:0 auto;color:#111827">
    <p style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#6b7280;margin:0">Internal operations alert — not sent to regulators</p>
    <h2 style="margin:4px 0 2px">nTZS Daily Reserve Attestation</h2>
    <p style="margin:0 0 16px;color:#6b7280">Report date (EAT): <b>${inc.reportDate}</b></p>
    <p style="display:inline-block;padding:6px 12px;border-radius:6px;background:#d977061a;color:#d97706;font-weight:700;margin:0 0 16px">⚠️ READING INCOMPLETE — NOT ATTESTED</p>
    <p style="font-size:13px;color:#374151;margin:0 0 8px">
      One or more reserve or supply sources could not be verified, so no attestation was generated
      or sent for this run. Resolve the source below, then send the day's attestation from
      Backstage → Attestation (or POST /api/admin/attestation). No reserve deficiency is implied.
    </p>
    <ul style="font-size:12px;color:#6b7280;margin:0 0 12px;padding-left:18px">
      ${inc.failures.map((f) => `<li>${f}</li>`).join('')}
    </ul>
    ${
      inc.partial.pots.length > 0 || inc.partial.supplyTzs != null
        ? `<h3 style="margin:12px 0 6px;font-size:13px;color:#374151">What DID read (provisional — not attested)</h3>
    <table style="border-collapse:collapse;width:100%;font-size:12px">
      ${inc.partial.supplyTzs != null ? row('On-chain supply', fmt(inc.partial.supplyTzs) + ' nTZS') : ''}
      ${inc.partial.pots.map((p) => row(p.label, 'TZS ' + fmt(p.amountTzs))).join('')}
      ${inc.partial.provisionalCoveragePct != null ? row('<b>Provisional raw coverage</b>', `<b>${inc.partial.provisionalCoveragePct.toFixed(2)} %</b>`) : ''}
    </table>`
        : ''
    }
    <p style="font-size:11px;color:#9ca3af;margin:8px 0 0">Generated at ${inc.generatedAt}</p>
  </div>`
}

// ─── Generate + persist + send ───────────────────────────────────────────────

/** Generate, persist (idempotent per EAT day), and email the daily attestation.
 * Incomplete readings send an alert and persist nothing — a later successful
 * run (cron retry or POST /api/admin/attestation) files the day's report. */
export async function generateDailyAttestation(): Promise<AttestationReport | IncompleteAttestation> {
  const report = await computeAttestation()
  const to = recipients()

  if (isIncomplete(report)) {
    // Plumbing alert → ops only. The regulator list gets attestations, never
    // internal failure notices.
    const subject = `⚠️ nTZS Attestation INCOMPLETE — ${report.reportDate} — manual review required`
    try {
      await sendEmail({ to: internalRecipients(), subject, html: incompleteEmailHtml(report) })
    } catch (e) {
      console.error('[attestation] incomplete-alert email failed:', e instanceof Error ? e.message : e)
    }
    console.error('[attestation] INCOMPLETE:', report.failures.join(' | '))
    return report
  }

  const { db } = getDb()

  // Day-over-day context for the annex, from yesterday's persisted row.
  let deltaLine = ''
  try {
    const [prev] = await db
      .select({ deviationPct: attestations.deviationPct, reportDate: attestations.reportDate })
      .from(attestations)
      .where(eq(attestations.reportDate, eatDate(new Date(Date.now() - 24 * 3600 * 1000))))
      .limit(1)
    if (prev) {
      const prevDev = Number(prev.deviationPct)
      const diff = report.deviationPct - prevDev
      deltaLine = `Raw deviation moved ${diff >= 0 ? '+' : ''}${diff.toFixed(4)} pp since ${prev.reportDate} (${prevDev.toFixed(4)}% → ${report.deviationPct.toFixed(4)}%).`
    }
  } catch {
    // context only — never blocks the report
  }

  const values = {
    ntzsCirculation: report.ntzsCirculation.toFixed(2),
    tzsCustodialReserve: report.tzsCustodialReserve.toFixed(2),
    tzsGovtSecurities: report.tzsGovtSecurities.toFixed(2),
    reserveTotal: report.reserveTotal.toFixed(2),
    deviationPct: report.deviationPct.toFixed(6),
    fullyBacked: report.fullyBacked,
    withinKpi: report.withinKpi,
    blockNumber: report.blockNumber ?? null,
    supplySource: report.supplySource,
    reserveSource: report.reserveSource,
    reportHash: report.reportHash,
    emailedTo: to.join(', '),
  }

  // Annex persists as JSONB once drizzle/0062 is applied; until then fall back
  // to the legacy row so the attestation itself is never blocked.
  try {
    await db
      .insert(attestations)
      .values({ reportDate: report.reportDate, ...values, annex: report.annex } as typeof attestations.$inferInsert)
      .onConflictDoUpdate({ target: attestations.reportDate, set: { ...values, annex: report.annex } as Partial<typeof attestations.$inferInsert> })
  } catch (e) {
    console.warn('[attestation] annex persist failed (apply drizzle/0062); storing legacy row:', e instanceof Error ? e.message : e)
    await db
      .insert(attestations)
      .values({ reportDate: report.reportDate, ...values })
      .onConflictDoUpdate({ target: attestations.reportDate, set: values })
  }

  const subject = report.fullyBacked
    ? `nTZS Daily Reserve Attestation · ${report.reportDate} · Fully backed`
    : `⚠️ URGENT: nTZS reserve UNDER-BACKED · ${report.reportDate} · peg breach`

  // Regulator copy: classic (a)–(d) format. The reconciliation annex joins it
  // only once explicitly promoted (ATTESTATION_ANNEX_TO_REGULATOR=true) —
  // until the residual is understood and stable it is an internal instrument.
  const annexToRegulator = process.env.ATTESTATION_ANNEX_TO_REGULATOR === 'true'
  try {
    await sendEmail({ to, subject, html: reportEmailHtml(report, deltaLine, annexToRegulator) })
  } catch (e) {
    console.error('[attestation] email failed:', e instanceof Error ? e.message : e)
  }

  // Internal copy always carries the full annex (skip anyone already on the
  // regulator list when they got the annex there).
  const internalOnly = internalRecipients().filter((r) => annexToRegulator ? !to.includes(r) : true)
  if (internalOnly.length > 0) {
    try {
      await sendEmail({
        to: internalOnly,
        subject: `nTZS Reserve Reconciliation (internal) · ${report.reportDate} · adjusted ${report.annex.adjustedCoveragePct.toFixed(2)}%`,
        html: reportEmailHtml(report, deltaLine, true),
      })
    } catch (e) {
      console.error('[attestation] internal annex email failed:', e instanceof Error ? e.message : e)
    }
  }
  return report
}
