import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { ethers } from 'ethers'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import {
  auditLogs,
  burnRequests,
  dailyIssuance,
  depositRequests,
  kycCases,
  reconciliationEntries,
  users,
} from '@ntzs/db'
import {
  SANDBOX_DAILY_USER_CAP_TZS,
  SANDBOX_MONTHLY_USER_CAP_TZS,
  SANDBOX_PER_TXN_CAP_TZS,
} from '@/lib/sandbox/limits'
import { ExportReportButton } from '../oversight/_components/ExportReportButton'

// ── Constants ────────────────────────────────────────────────────────────────

const CONTRACT_ADDRESS = NTZS_CONTRACT_ADDRESS_BASE
const SAFE_ADDRESS = '0xB2b8C08a9AEB0E22242e6fC9cD78FC2402cBC503'
const BOT_APPROVAL_REF = 'LD. 170/515/02/1254'
const SANDBOX_DEADLINE = new Date('2026-06-23T00:00:00.000Z')
const PLATFORM_DAILY_CAP_TZS = Number(process.env.DAILY_ISSUANCE_CAP_TZS ?? '100000000')

async function getOnChainTotalSupply(): Promise<number> {
  if (!CONTRACT_ADDRESS) return 0
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const contract = new ethers.Contract(
      CONTRACT_ADDRESS,
      ['function totalSupply() view returns (uint256)'],
      provider
    )
    const supply = await contract.totalSupply()
    return Number(ethers.formatUnits(supply, 18))
  } catch {
    return 0
  }
}

function fmt(n: number) {
  return `TZS ${n.toLocaleString('en-TZ', { maximumFractionDigits: 0 })}`
}

function pct(used: number, total: number) {
  if (!total) return 0
  return Math.min(100, Math.round((used / total) * 100))
}

function daysUntil(target: Date) {
  return Math.max(0, Math.ceil((target.getTime() - Date.now()) / 86_400_000))
}

// ── BoT parameter compliance declarations ────────────────────────────────────
// Status is a code-time declaration, updated as features ship.
// Not computed from DB — it's an assertion of implementation status.

type ParamStatus = 'implemented' | 'in_progress' | 'pending' | 'process_item'

interface BotParam {
  ref: string
  description: string
  status: ParamStatus
  note?: string
}

const BLOCKING_PARAMS: BotParam[] = [
  { ref: 'Para #3', description: 'Per-transaction cap (TZS 1,000,000)', status: 'implemented', note: 'Enforced in all deposit, burn & transfer APIs' },
  { ref: 'Para #4', description: 'Daily per-user limit (TZS 2,000,000)', status: 'implemented', note: 'Rolling 24-hour sum across deposits + burns' },
  { ref: 'Para #5', description: 'Monthly per-user cap (TZS 60,000,000)', status: 'implemented', note: '30-day rolling window' },
  { ref: 'Para #6', description: 'Platform daily issuance cap (TZS 100,000,000)', status: 'implemented', note: 'dailyIssuance table + cron enforcement' },
  { ref: 'Para #2', description: 'Sandbox user cap (100 participants)', status: 'pending', note: 'Scoped to new bank/PSP corridor — existing Snippe users unaffected' },
  { ref: 'Para #8', description: 'Biometric KYC + OTP verification', status: 'pending', note: 'Smile Identity integration planned' },
  { ref: 'Para #8', description: 'PEP screening + sanctions checks', status: 'pending', note: 'UN / BoT / OFAC screening before wallet activation' },
  { ref: 'Para #14', description: 'Multi-sig minting keys (Gnosis Safe)', status: 'in_progress', note: 'Safe deployed; mint_requires_safe flow pending full wiring' },
  { ref: 'Para #7 / LR-2', description: 'Automated daily reserve report to BoT at 10:00 EAT', status: 'pending' },
  { ref: 'LR-1', description: 'Operational liquidity buffer (20% of 30-day avg redemptions)', status: 'pending' },
  { ref: 'Para #12', description: 'TZS-only UI (no nTZS terminology to end users)', status: 'pending', note: 'UI audit required' },
]

const OPERATIONAL_PARAMS: BotParam[] = [
  { ref: 'AML-1–7', description: 'AML/CFT programme (EDD, STR, FIU reporting)', status: 'pending' },
  { ref: 'R-11', description: 'Consumer complaint SLA (≥90% resolved in 5 days)', status: 'pending' },
  { ref: 'Para #9', description: 'Tax compliance reporting (VAT/WHT + TRA)', status: 'pending' },
  { ref: 'Para #16', description: 'Monthly BoT operational report', status: 'pending' },
  { ref: 'R-2', description: 'Quarterly BoT progress report', status: 'pending' },
  { ref: 'TR-1–4', description: 'FATF Travel Rule (cross-border >TZS 2,500,000)', status: 'pending' },
  { ref: 'ST-1–4', description: 'Quarterly stress testing framework (5 scenarios)', status: 'pending' },
  { ref: 'BC-1–3', description: 'BCP/DR documentation (RTO 4h, RPO 1h)', status: 'pending' },
]

const PRE_TESTING_PARAMS: BotParam[] = [
  { ref: 'Para #7(a)', description: 'Executed Testing Environment Agreement', status: 'process_item' },
  { ref: 'Para #7(b)', description: 'Formal PSP partnership confirmation letter', status: 'process_item' },
  { ref: 'Para #7(c)', description: 'nTZS issuance/redemption protocol + token flow diagram', status: 'process_item' },
  { ref: 'Para #7(d)', description: 'Risk Management Plan (incl. fake e-money creation risk)', status: 'process_item' },
  { ref: 'PD-1', description: 'Register with Personal Data Protection Commission', status: 'process_item' },
  { ref: 'R-10', description: 'Evidence of IP ownership / smart contract registration', status: 'process_item' },
]

const STATUS_LABELS: Record<ParamStatus, string> = {
  implemented: 'Implemented',
  in_progress: 'In Progress',
  pending: 'Pending',
  process_item: 'Process Item',
}

const STATUS_STYLES: Record<ParamStatus, string> = {
  implemented: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  process_item: 'bg-gray-100 text-gray-600 border-gray-200',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t border-gray-200 pt-10">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

function MetricCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: 'green' | 'red' | 'amber' | 'neutral' }) {
  const colours = {
    green: 'border-l-emerald-500',
    red: 'border-l-red-500',
    amber: 'border-l-amber-500',
    neutral: 'border-l-gray-300',
  }
  return (
    <div className={`rounded-lg border border-gray-200 border-l-4 ${colours[highlight ?? 'neutral']} bg-white p-5 shadow-sm`}>
      <div className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-gray-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

function StatusBadge({ status }: { status: ParamStatus }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function ParamTable({ params }: { params: BotParam[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400 w-28">Reference</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Requirement</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400 w-36">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {params.map((p, i) => (
            <tr key={i} className="hover:bg-gray-50/50">
              <td className="px-4 py-3 font-mono text-xs text-gray-500 align-top">{p.ref}</td>
              <td className="px-4 py-3 text-gray-700">
                {p.description}
                {p.note && <div className="mt-0.5 text-xs text-gray-400">{p.note}</div>}
              </td>
              <td className="px-4 py-3 align-top"><StatusBadge status={p.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function CompliancePortal() {
  await requireAnyRole(['platform_compliance', 'super_admin', 'bot_regulator'])

  const { db } = getDb()
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const startOfToday = new Date(now); startOfToday.setUTCHours(0, 0, 0, 0)
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const daysToDeadline = daysUntil(SANDBOX_DEADLINE)
  const sandboxPhase = daysToDeadline > 0 ? 'Pre-commencement' : 'Active Testing'

  // All data fetched in parallel
  const [
    onChainSupply,
    dbMainnetMinted,
    reconAdjustments,
    kycStats,
    endUserCount,
    todayIssuance,
    last24hDeposits,
    last24hBurns,
    recentAuditEnforcement,
    liquidityData,
  ] = await Promise.all([
    // 1. On-chain supply — THE reserve truth
    getOnChainTotalSupply(),

    // 2. DB minted (mainnet only — excludes testnet/ZenoPay test records)
    db.select({
      total: sql<number>`coalesce(sum(${depositRequests.amountTzs}), 0)`.mapWith(Number),
    }).from(depositRequests).where(
      and(eq(depositRequests.status, 'minted'), eq(depositRequests.chain, 'base'))
    ).then(r => r[0]?.total ?? 0),

    // 3. Reconciliation adjustments (opening balance, corrections)
    db.select({
      total: sql<number>`coalesce(sum(${reconciliationEntries.amountTzs}), 0)`.mapWith(Number),
    }).from(reconciliationEntries).where(
      eq(reconciliationEntries.chain, 'base')
    ).then(r => r[0]?.total ?? 0),

    // 4. KYC stats
    db.select({
      total: sql<number>`count(*)`.mapWith(Number),
      approved: sql<number>`count(*) filter (where ${kycCases.status} = 'approved')`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${kycCases.status} = 'pending')`.mapWith(Number),
      rejected: sql<number>`count(*) filter (where ${kycCases.status} = 'rejected')`.mapWith(Number),
    }).from(kycCases).then(r => r[0]),

    // 5. End user count
    db.select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(users).where(eq(users.role, 'end_user'))
      .then(r => r[0]?.count ?? 0),

    // 6. Today's platform issuance
    db.select().from(dailyIssuance).where(eq(dailyIssuance.day, todayStr)).limit(1)
      .then(r => r[0]),

    // 7. Last 24h deposit activity
    db.select({
      count: sql<number>`count(*)`.mapWith(Number),
      totalTzs: sql<number>`coalesce(sum(${depositRequests.amountTzs}), 0)`.mapWith(Number),
      rejected: sql<number>`count(*) filter (where ${depositRequests.status} = 'rejected')`.mapWith(Number),
    }).from(depositRequests).where(gte(depositRequests.createdAt, last24h))
      .then(r => r[0]),

    // 8. Last 24h burn/redemption activity
    db.select({
      count: sql<number>`count(*)`.mapWith(Number),
      totalTzs: sql<number>`coalesce(sum(${burnRequests.amountTzs}), 0)`.mapWith(Number),
    }).from(burnRequests).where(
      and(gte(burnRequests.createdAt, last24h), eq(burnRequests.status, 'burned'))
    ).then(r => r[0]),

    // 9. Recent enforcement actions for governance section
    db.select({
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      createdAt: auditLogs.createdAt,
      actorEmail: users.email,
    }).from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(inArray(auditLogs.action, ['freeze_wallet', 'blacklist_wallet', 'unfreeze_wallet', 'pause_contract', 'wipe_wallet']))
      .orderBy(desc(auditLogs.createdAt))
      .limit(5),

    // 10. 30-day burn totals by day for liquidity buffer calc
    db.select({
      totalBurned30d: sql<number>`coalesce(sum(${burnRequests.amountTzs}), 0)`.mapWith(Number),
      burnDays: sql<number>`count(distinct date_trunc('day', ${burnRequests.createdAt}))`.mapWith(Number),
    }).from(burnRequests).where(
      and(eq(burnRequests.status, 'burned'), gte(burnRequests.createdAt, thirtyDaysAgo),
        eq(burnRequests.chain, 'base'))
    ).then(r => r[0]),
  ])

  // Derived figures
  const discrepancy = Math.round(onChainSupply - (dbMainnetMinted + reconAdjustments))
  const fullyReconciled = Math.abs(discrepancy) < 1

  const issuedToday = todayIssuance?.issuedTzs ?? 0
  const dailyCapUsedPct = pct(issuedToday, PLATFORM_DAILY_CAP_TZS)

  const avg30dDailyRedemptions = liquidityData && liquidityData.burnDays > 0
    ? liquidityData.totalBurned30d / liquidityData.burnDays
    : null
  const requiredLiquidityBuffer = avg30dDailyRedemptions != null
    ? Math.round(avg30dDailyRedemptions * 30 * 0.20)
    : null

  const generatedAt = now.toLocaleString('en-TZ', {
    timeZone: 'Africa/Dar_es_Salaam',
    dateStyle: 'long',
    timeStyle: 'medium',
  })

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Document header ─────────────────────────────────────────────── */}
      <div className="border-b border-gray-200 bg-white px-6 py-5 shadow-sm">
        <div className="mx-auto max-w-5xl flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold tracking-tight text-gray-900">nTZS Compliance Portal</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 border border-gray-200">
                NEDA LABS Limited
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-400">
              BoT Sandbox Ref. {BOT_APPROVAL_REF} · Generated {generatedAt} EAT
            </div>
          </div>
          <div className="shrink-0">
            <ExportReportButton />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-10 px-6 py-10">

        {/* ── Section 1: Sandbox Status Banner ──────────────────────────── */}
        <div className={`rounded-lg border px-6 py-5 ${daysToDeadline <= 14 ? 'border-red-200 bg-red-50' : daysToDeadline <= 30 ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${daysToDeadline > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                  {sandboxPhase}
                </span>
                <span className="text-xs text-gray-500">Bank of Tanzania Fintech Regulatory Sandbox</span>
              </div>
              <div className="mt-2 text-sm font-medium text-gray-800">
                Approval reference: <span className="font-mono">{BOT_APPROVAL_REF}</span> · Approved 23 April 2026
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold tabular-nums text-gray-900">{daysToDeadline}</div>
              <div className="text-xs text-gray-500">days to commencement deadline (23 June 2026)</div>
            </div>
          </div>
        </div>

        {/* ── Section 2: Reserve Integrity ──────────────────────────────── */}
        <Section
          id="reserves"
          title="Reserve Integrity"
          subtitle="On-chain supply is the authoritative figure. DB-tracked mints and reconciliation entries provide the paper trail. All figures are Base mainnet only."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="nTZS in circulation"
              value={fmt(onChainSupply)}
              sub="Live — Base mainnet totalSupply()"
              highlight="neutral"
            />
            <MetricCard
              label="DB-tracked mints (mainnet)"
              value={fmt(dbMainnetMinted)}
              sub="depositRequests where status=minted AND chain=base"
              highlight="neutral"
            />
            <MetricCard
              label="Reconciliation adjustments"
              value={fmt(reconAdjustments)}
              sub="Opening balance, corrections (reconciliationEntries)"
              highlight="neutral"
            />
            <MetricCard
              label="Unexplained variance"
              value={fullyReconciled ? 'TZS 0' : fmt(Math.abs(discrepancy))}
              sub={fullyReconciled ? 'Fully reconciled ✓' : discrepancy > 0 ? 'On-chain exceeds DB — investigate' : 'DB exceeds on-chain — investigate'}
              highlight={fullyReconciled ? 'green' : 'red'}
            />
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 text-sm">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <span className="font-medium text-gray-700">Reserve ratio:</span>{' '}
                <span className="font-semibold text-emerald-700">100% — enforced by dual-approval mint workflow</span>
                <div className="mt-0.5 text-xs text-gray-400">
                  Every nTZS token is minted only after bank confirmation of TZS fiat receipt.
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="font-medium text-gray-700">Liquidity buffer (LR-1):</span>{' '}
                {requiredLiquidityBuffer != null
                  ? <span className="font-semibold text-amber-700">Required: {fmt(requiredLiquidityBuffer)} (20% × 30-day avg redemptions)</span>
                  : <span className="text-gray-400 italic">Insufficient redemption history (&lt;30 days)</span>}
              </div>
            </div>
          </div>

          <div className="mt-3 flex gap-4 text-xs text-gray-400">
            <a
              href={`https://basescan.org/token/${CONTRACT_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-600 underline underline-offset-2"
            >
              Verify on-chain supply independently at Basescan ↗
            </a>
          </div>
        </Section>

        {/* ── Section 3: Issuance Controls ──────────────────────────────── */}
        <Section
          id="issuance"
          title="Issuance Controls"
          subtitle="All transaction limits are enforced at the API layer (lib/sandbox/limits.ts) with full audit trail."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Para #6 — Platform daily cap with live utilization */}
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-wider text-gray-400">Para #6 — Platform daily cap</div>
                <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Enforced</span>
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-gray-900">{fmt(PLATFORM_DAILY_CAP_TZS)}</div>
              <div className="mt-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Issued today: {fmt(issuedToday)}</span>
                  <span>{dailyCapUsedPct}% used</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full transition-all ${dailyCapUsedPct > 90 ? 'bg-red-500' : dailyCapUsedPct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${dailyCapUsedPct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Three static enforcement cards */}
            {[
              { ref: 'Para #3', label: 'Per-transaction cap', limit: SANDBOX_PER_TXN_CAP_TZS, note: 'Hard-rejected at API — no exceptions' },
              { ref: 'Para #4', label: 'Daily per-user limit', limit: SANDBOX_DAILY_USER_CAP_TZS, note: 'Rolling 24-hour window (deposits + burns)' },
              { ref: 'Para #5', label: 'Monthly per-user cap', limit: SANDBOX_MONTHLY_USER_CAP_TZS, note: '30-day rolling window (deposits + burns)' },
            ].map(({ ref, label, limit, note }) => (
              <div key={ref} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium uppercase tracking-wider text-gray-400">{ref} — {label}</div>
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Enforced</span>
                </div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-gray-900">{fmt(limit)}</div>
                <div className="mt-2 text-xs text-gray-400">{note}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Section 4: BoT Parameter Compliance Grid ──────────────────── */}
        <Section
          id="parameters"
          title="BoT Sandbox Parameter Compliance"
          subtitle="Status as of report generation date. 'Implemented' denotes live code in production. 'Process Item' denotes a documentation or registration task."
        >
          <div className="space-y-6">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-gray-700 uppercase tracking-wide">🔴 Blocking — Required before commencement</h3>
              <ParamTable params={BLOCKING_PARAMS} />
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-gray-700 uppercase tracking-wide">🟡 Required during sandbox operation</h3>
              <ParamTable params={OPERATIONAL_PARAMS} />
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-gray-700 uppercase tracking-wide">🔵 Pre-testing documents to submit to BoT</h3>
              <ParamTable params={PRE_TESTING_PARAMS} />
            </div>
          </div>
        </Section>

        {/* ── Section 5: KYC & User Overview ────────────────────────────── */}
        <Section
          id="kyc"
          title="KYC & User Overview"
          subtitle="Identity verification status and user registration summary."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="KYC — Approved" value={String(kycStats?.approved ?? 0)} highlight="green" />
            <MetricCard label="KYC — Pending review" value={String(kycStats?.pending ?? 0)} highlight={kycStats?.pending ? 'amber' : 'neutral'} />
            <MetricCard label="KYC — Rejected" value={String(kycStats?.rejected ?? 0)} highlight="neutral" />
            <MetricCard
              label="Registered end users"
              value={String(endUserCount)}
              sub="Sandbox participant cap (100) applies to new bank/PSP corridor"
              highlight="neutral"
            />
          </div>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>Para #8 — Pending:</strong> Biometric selfie verification (Smile Identity) and PEP/sanctions screening are not yet integrated.
            Current KYC is national ID + document upload with manual review.
          </div>
        </Section>

        {/* ── Section 6: 24h Activity Summary ───────────────────────────── */}
        <Section
          id="activity"
          title="Transaction Activity — Last 24 Hours"
          subtitle="Summary of deposit and redemption activity through the platform."
        >
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Category</th>
                  <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-400">Count</th>
                  <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-400">Volume</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="px-5 py-3 text-gray-700">Deposits initiated (all statuses)</td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-900">{last24hDeposits?.count ?? 0}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-900">{fmt(last24hDeposits?.totalTzs ?? 0)}</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-gray-700">Redemptions completed (burned on-chain)</td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-900">{last24hBurns?.count ?? 0}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-900">{fmt(last24hBurns?.totalTzs ?? 0)}</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-gray-700">Rejected / failed deposits</td>
                  <td className={`px-5 py-3 text-right tabular-nums font-medium ${(last24hDeposits?.rejected ?? 0) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {last24hDeposits?.rejected ?? 0}
                  </td>
                  <td className="px-5 py-3 text-right text-gray-400">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Full activity tables (deposits, withdrawals, audit trail) are available in the{' '}
            <a href="/app/oversight" className="underline underline-offset-2 hover:text-gray-600">Oversight Dashboard</a>.
          </p>
        </Section>

        {/* ── Section 7: Governance & Smart Contract ────────────────────── */}
        <Section
          id="governance"
          title="Governance & Smart Contract"
          subtitle="On-chain contract details and role accountability."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Contract details */}
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Smart Contract</h3>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500 shrink-0">Network</dt>
                  <dd className="text-gray-900 font-medium text-right">Base Mainnet (Chain ID 8453)</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500 shrink-0">Contract type</dt>
                  <dd className="text-gray-900 font-medium text-right">NTZSV2 — UUPS upgradeable ERC-20</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-gray-500">Proxy address</dt>
                  <dd>
                    <a
                      href={`https://basescan.org/token/${CONTRACT_ADDRESS}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-blue-600 hover:underline break-all"
                    >
                      {CONTRACT_ADDRESS}
                    </a>
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-gray-500">Gnosis Safe (admin)</dt>
                  <dd>
                    <a
                      href={`https://basescan.org/address/${SAFE_ADDRESS}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-blue-600 hover:underline break-all"
                    >
                      {SAFE_ADDRESS}
                    </a>
                  </dd>
                </div>
                <div className="pt-2 border-t border-gray-100">
                  <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                    Independent third-party audit required before BoT sandbox commencement.
                  </div>
                </div>
              </dl>
            </div>

            {/* Roles + enforcement actions */}
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Contract Roles</h3>
                <table className="min-w-full text-xs">
                  <tbody className="divide-y divide-gray-100">
                    {[
                      ['MINTER_ROLE', 'Mint nTZS (requires prior fiat confirmation)'],
                      ['BURNER_ROLE', 'Burn nTZS on redemption'],
                      ['PAUSER_ROLE', 'Emergency pause all transfers'],
                      ['FREEZER_ROLE', 'Freeze individual wallet'],
                      ['BLACKLISTER_ROLE', 'Permanently block address'],
                      ['WIPER_ROLE', 'Burn balance of blacklisted address'],
                    ].map(([role, desc]) => (
                      <tr key={role}>
                        <td className="py-1.5 pr-3 font-mono text-gray-500">{role}</td>
                        <td className="py-1.5 text-gray-600">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {recentAuditEnforcement.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Enforcement Actions</h3>
                  <div className="space-y-2">
                    {recentAuditEnforcement.map((entry, i) => (
                      <div key={i} className="flex items-start justify-between gap-2 text-xs">
                        <div>
                          <span className="font-medium text-gray-700">{entry.action.replace(/_/g, ' ')}</span>
                          {entry.actorEmail && <span className="text-gray-400 ml-1">by {entry.actorEmail}</span>}
                        </div>
                        <span className="text-gray-400 shrink-0">
                          {new Date(entry.createdAt!).toLocaleDateString('en-TZ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* ── Section 8: Export & Document Center ───────────────────────── */}
        <Section
          id="export"
          title="Export & Documents"
          subtitle="Download the compliance report or access submission documents for BoT."
        >
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <div className="text-sm font-medium text-gray-700">Reserves & Compliance Report (PDF)</div>
                <div className="mt-1 text-xs text-gray-400">
                  Includes on-chain supply, reserve verification, KYC posture, issuance controls, and recent deposit activity.
                </div>
                <div className="mt-3">
                  <ExportReportButton />
                </div>
              </div>
              <div className="text-sm text-gray-500 space-y-1">
                <div className="font-medium text-gray-700 mb-2">Pre-testing submission documents</div>
                <div className="text-gray-400 italic text-xs">Testing Environment Agreement — pending execution</div>
                <div className="text-gray-400 italic text-xs">PSP partnership confirmation — pending</div>
                <div className="text-gray-400 italic text-xs">Risk Management Plan — pending</div>
                <div className="text-gray-400 italic text-xs">nTZS token flow diagram — pending</div>
              </div>
            </div>
          </div>
        </Section>

        {/* Footer */}
        <div className="border-t border-gray-200 pt-6 text-xs text-gray-400 flex flex-wrap justify-between gap-2">
          <div>NEDA LABS Company Limited · Dar es Salaam, Tanzania · nTZS Stablecoin Compliance Portal</div>
          <div>Data current as of {generatedAt} EAT · Refresh page for latest</div>
        </div>

      </div>
    </div>
  )
}
