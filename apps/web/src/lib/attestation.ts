import crypto from 'crypto'
import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { attestations } from '@ntzs/db'
import { getReserveBalances } from '@/lib/psp'
import { sendEmail } from '@/lib/email'
import { POOL_ALERT_RECIPIENTS } from '@/lib/fx/alert-email'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'

/**
 * Daily reserve attestation — BoT sandbox Parameter 7 + 16.
 *
 * Produces the 10:00 EAT reconciliation submitted to the Bank of Tanzania:
 *   (a) total nTZS in circulation        — on-chain totalSupply()
 *   (b) TZS held in custodial reserve     — PSP settled balance
 *   (c) TZS invested in government securities (T-bills)
 *   (d) deviation from the 1:1 ratio (target 0.00%)
 * The hard rule: nTZS outstanding must never exceed the TZS reserve. Under-backing
 * is a peg breach → urgent notification (Parameter 7 also requires suspending new
 * minting; that mint-path hook is the immediate follow-up).
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
}

async function readChain(): Promise<{ supply: number; block: number | null }> {
  if (!NTZS_CONTRACT_ADDRESS_BASE) return { supply: 0, block: null }
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const contract = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, ['function totalSupply() view returns (uint256)'], provider)
    const [supply, block] = await Promise.all([
      contract.totalSupply(),
      provider.getBlockNumber().catch(() => null),
    ])
    return { supply: Number(ethers.formatUnits(supply, 18)), block }
  } catch {
    return { supply: 0, block: null }
  }
}

/** Compute the attestation figures with no persistence — used by preview + cron. */
export async function computeAttestation(): Promise<AttestationReport> {
  const reportDate = eatDate()
  const [{ supply, block }, pots] = await Promise.all([readChain(), getReserveBalances()])
  const ntzsCirculation = supply

  // Pooled-reserve principle: the custodial reserve is the SUM of every PSP
  // pot (Snippe + Selcom + …). A pot whose fetch failed is UNKNOWN, not zero —
  // it is excluded from the sum (conservative: can only under-state backing)
  // and loudly flagged in reserveSource so a fetch outage is never mistaken
  // for a healthy figure.
  const okPots = pots.filter((p) => !p.error)
  const failedPots = pots.filter((p) => p.error)
  const tzsCustodialReserve = okPots.reduce((sum, p) => sum + (Number(p.available) || 0), 0)
  const tzsGovtSecurities = govtSecuritiesTzs()
  const reserveTotal = tzsCustodialReserve + tzsGovtSecurities
  const deviationPct = ntzsCirculation > 0 ? ((reserveTotal - ntzsCirculation) / ntzsCirculation) * 100 : 0
  const fullyBacked = reserveTotal >= ntzsCirculation
  const withinKpi = fullyBacked // peg intact while reserves cover supply; over-backing is safe

  const potSummary = okPots.map((p) => `${p.label}: ${(Number(p.available) || 0).toLocaleString('en-US')} ${p.currency}`).join(' + ')
  const failureSummary = failedPots.length
    ? ` ⚠ UNVERIFIED POTS (fetch failed, excluded): ${failedPots.map((p) => p.label).join(', ')}`
    : ''
  if (failedPots.length) {
    console.error('[attestation] reserve pot fetch failed — figure under-states backing', failedPots.map((p) => ({ provider: p.provider, error: p.error })))
  }

  const core = {
    reportDate,
    ntzsCirculation,
    tzsCustodialReserve,
    tzsGovtSecurities,
    reserveTotal,
    deviationPct: +deviationPct.toFixed(6),
    fullyBacked,
    withinKpi,
    blockNumber: block,
    supplySource: `Base Mainnet · ${NTZS_CONTRACT_ADDRESS_BASE ?? 'n/a'} · totalSupply()`,
    reserveSource: `PSP settled balances — ${potSummary || 'none configured'}${failureSummary}`,
  }
  const reportHash = crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex')
  return { ...core, reportHash, generatedAt: new Date().toISOString() }
}

function reportEmailHtml(r: AttestationReport): string {
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  const color = r.fullyBacked ? '#059669' : '#dc2626'
  const status = r.fullyBacked ? 'FULLY BACKED — 1:1 peg maintained' : '⚠️ UNDER-BACKED — PEG BREACH'
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 12px;border:1px solid #e5e7eb;color:#374151">${label}</td><td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;font-weight:600;color:#111827">${value}</td></tr>`
  return `
  <div style="font-family:ui-monospace,Menlo,monospace;max-width:640px;margin:0 auto;color:#111827">
    <p style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#6b7280;margin:0">Bank of Tanzania · Sandbox Ref. LD.170/515/02/1254</p>
    <h2 style="margin:4px 0 2px">nTZS Daily Reserve Attestation</h2>
    <p style="margin:0 0 16px;color:#6b7280">Report date (EAT): <b>${r.reportDate}</b> · Parameter 7 &amp; 16</p>
    <p style="display:inline-block;padding:6px 12px;border-radius:6px;background:${color}1a;color:${color};font-weight:700;margin:0 0 16px">${status}</p>
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
    <table style="border-collapse:collapse;width:100%;font-size:11px;color:#6b7280;margin-top:8px">
      ${row('Supply source', r.supplySource)}
      ${row('Reserve source', r.reserveSource)}
      ${row('Base block height', r.blockNumber != null ? String(r.blockNumber) : 'n/a')}
      ${row('Report hash (SHA-256)', r.reportHash)}
      ${row('Generated at', r.generatedAt)}
    </table>
  </div>`
}

/** Generate, persist (idempotent per EAT day), and email the daily attestation. */
export async function generateDailyAttestation(): Promise<AttestationReport> {
  const report = await computeAttestation()
  const { db } = getDb()
  const to = recipients()

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

  await db
    .insert(attestations)
    .values({ reportDate: report.reportDate, ...values })
    .onConflictDoUpdate({ target: attestations.reportDate, set: values })

  const subject = report.fullyBacked
    ? `nTZS Daily Reserve Attestation · ${report.reportDate} · Fully backed`
    : `⚠️ URGENT: nTZS reserve UNDER-BACKED · ${report.reportDate} · peg breach`
  try {
    await sendEmail({ to, subject, html: reportEmailHtml(report) })
  } catch (e) {
    console.error('[attestation] email failed:', e instanceof Error ? e.message : e)
  }
  return report
}
