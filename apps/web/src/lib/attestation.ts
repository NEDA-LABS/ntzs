import crypto from 'crypto'
import { ethers } from 'ethers'
import { and, eq, inArray, isNull, isNotNull, notInArray, or, sql as dsql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { attestations, burnRequests, depositRequests, orphanPayments } from '@ntzs/db'
import * as snippe from '@/lib/psp/snippe'
import * as azampay from '@/lib/psp/azampay'
import * as selcom from '@/lib/psp/selcom'
import { sendEmail } from '@/lib/email'
import { POOL_ALERT_RECIPIENTS } from '@/lib/fx/alert-email'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import { computeAnnex, type AttestationAnnex, type ReservePot } from '@/lib/attestation-math'

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
 *   3. NEVER attests a degraded reading: if the chain or any configured pot
 *      cannot be read, an INCOMPLETE alert is sent instead of a fabricated
 *      "fully backed" or a false peg breach, and no row is persisted for the
 *      day (re-run via POST /api/admin/attestation once resolved).
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
}

export interface IncompleteAttestation {
  status: 'incomplete'
  reportDate: string
  failures: string[]
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
    return { failure: `Snippe balance read failed: ${e instanceof Error ? e.message : e}` }
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
      return { failure: `AzamPay balance read failed: ${e instanceof Error ? e.message : e}` }
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
    return { failure: `AzamPay book balance query failed: ${e instanceof Error ? e.message : e}` }
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
    return { failure: `Selcom balance read failed: ${e instanceof Error ? e.message : e}` }
  }
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
  const [orphanRow] = await db
    .select({ total: dsql<string>`coalesce(sum(${orphanPayments.amountTzs}), 0)` })
    .from(orphanPayments)
    .where(and(eq(orphanPayments.status, 'unmatched'), eq(orphanPayments.currency, 'TZS')))
  const orphanUnmatchedTzs = Number(orphanRow?.total ?? 0)

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

  return { burnedUnpaidTzs, feesUnmintedTzs, orphanUnmatchedTzs, paidUnmintedTzs }
}

// ─── Compute ─────────────────────────────────────────────────────────────────

/** Compute the attestation figures with no persistence — used by preview + cron.
 * Returns an IncompleteAttestation instead of numbers when any configured
 * source cannot be read: a reading we could not verify is never attested. */
export async function computeAttestation(): Promise<AttestationReport | IncompleteAttestation> {
  const reportDate = eatDate()
  const [chain, snippePot, azamPot, selcomPot] = await Promise.all([
    readChain(),
    readSnippePot(),
    readAzamPayPot(),
    readSelcomPot(),
  ])

  const failures: string[] = []
  if (!chain.ok) failures.push(`Chain supply read failed: ${chain.error}`)
  for (const r of [snippePot, azamPot, selcomPot]) if (r.failure) failures.push(r.failure)

  let nettings
  try {
    nettings = await readNettings()
  } catch (e) {
    failures.push(`Obligation queries failed: ${e instanceof Error ? e.message : e}`)
  }

  if (failures.length > 0 || !nettings) {
    return { status: 'incomplete', reportDate, failures, generatedAt: new Date().toISOString() }
  }

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

  const annex = computeAnnex({ pots, nettings, totalSupplyTzs: chain.supply })

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
    <p style="font-size:11px;color:#6b7280;margin:8px 0 0">
      Adjusted coverage nets obligations already accrued against the reserves that hold their cash;
      100.0000% means every shilling of deviation is attributed. The residual carries the PSP fee
      spread and any opening float — a stable residual is expected, a drifting one is investigated.
      ${deltaLine}
    </p>`
}

function reportEmailHtml(r: AttestationReport, deltaLine: string): string {
  const color = r.fullyBacked ? '#059669' : '#dc2626'
  const status = r.fullyBacked ? 'FULLY BACKED — 1:1 peg maintained' : '⚠️ UNDER-BACKED — PEG BREACH'
  return `
  <div style="font-family:ui-monospace,Menlo,monospace;max-width:640px;margin:0 auto;color:#111827">
    <p style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#6b7280;margin:0">Bank of Tanzania · Sandbox Ref. LD.170/515/02/1254</p>
    <h2 style="margin:4px 0 2px">nTZS Daily Reserve Attestation</h2>
    <p style="margin:0 0 16px;color:#6b7280">Report date (EAT): <b>${r.reportDate}</b> · Parameter 7 &amp; 16</p>
    <p style="display:inline-block;padding:6px 12px;border-radius:6px;background:${color}1a;color:${color};font-weight:700;margin:0 0 4px">${status}</p>
    <p style="margin:0 0 16px;font-size:12px;color:#374151">Adjusted coverage after accrued obligations: <b>${r.annex.adjustedCoveragePct.toFixed(4)}%</b> · residual ${r.annex.residualPct >= 0 ? '+' : ''}${r.annex.residualPct.toFixed(4)}%</p>
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
    ${annexHtml(r.annex, deltaLine)}
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
    <p style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#6b7280;margin:0">Bank of Tanzania · Sandbox Ref. LD.170/515/02/1254</p>
    <h2 style="margin:4px 0 2px">nTZS Daily Reserve Attestation</h2>
    <p style="margin:0 0 16px;color:#6b7280">Report date (EAT): <b>${inc.reportDate}</b></p>
    <p style="display:inline-block;padding:6px 12px;border-radius:6px;background:#d977061a;color:#d97706;font-weight:700;margin:0 0 16px">⚠️ READING INCOMPLETE — NOT ATTESTED</p>
    <p style="font-size:13px;color:#374151;margin:0 0 8px">
      One or more reserve or supply sources could not be verified, so no attestation figures are
      published for this run. A corrected attestation for the same report date will follow once the
      reading is restored. No reserve deficiency is implied by this notice.
    </p>
    <ul style="font-size:12px;color:#6b7280;margin:0 0 12px;padding-left:18px">
      ${inc.failures.map((f) => `<li>${f}</li>`).join('')}
    </ul>
    <p style="font-size:11px;color:#9ca3af;margin:0">Generated at ${inc.generatedAt}</p>
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
    const subject = `⚠️ nTZS Attestation INCOMPLETE — ${report.reportDate} — manual review required`
    try {
      await sendEmail({ to, subject, html: incompleteEmailHtml(report) })
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
  try {
    await sendEmail({ to, subject, html: reportEmailHtml(report, deltaLine) })
  } catch (e) {
    console.error('[attestation] email failed:', e instanceof Error ? e.message : e)
  }
  return report
}
