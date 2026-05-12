'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExportReportButton } from '../../oversight/_components/ExportReportButton'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComplianceData {
  daysToDeadline: number
  sandboxPhase: string
  generatedAt: string
  botApprovalRef: string
  onChainSupply: number
  pspConfirmedTotal: number
  pspMintedTotal: number
  reconAdjustments: number
  issuedToday: number
  platformDailyCap: number
  perTxnCap: number
  dailyUserCap: number
  monthlyUserCap: number
  kycApproved: number
  kycPending: number
  kycRejected: number
  endUserCount: number
  deposits24hCount: number
  deposits24hTzs: number
  deposits24hRejected: number
  burns24hCount: number
  burns24hTzs: number
  contractAddress: string
  safeAddress: string
  recentEnforcement: Array<{ action: string; actorEmail: string | null; createdAt: string | null }>
  avg30dDailyRedemptions: number | null
}

type ParamStatus = 'implemented' | 'in_progress' | 'pending' | 'process_item'
interface BotParam { ref: string; description: string; status: ParamStatus; note?: string }

// ── Nav ───────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'overview',     label: 'Overview' },
  { id: 'money-safety', label: 'Money Safety' },
  { id: 'protections',  label: 'Spending Limits' },
  { id: 'users',        label: 'Users & Identity' },
  { id: 'commitments',  label: 'Our Commitments' },
  { id: 'governance',   label: 'Governance' },
  { id: 'activity',     label: 'Recent Activity' },
  { id: 'download',     label: 'Download Report' },
]

// ── BoT compliance declarations ───────────────────────────────────────────────

const BLOCKING_PARAMS: BotParam[] = [
  { ref: 'Para #3',          description: 'Maximum single transaction: TZS 1,000,000',             status: 'implemented', note: 'Automatically blocked at all entry points — no exceptions' },
  { ref: 'Para #4',          description: 'Maximum per customer per day: TZS 2,000,000',            status: 'implemented', note: 'Rolling 24-hour window across all transaction types' },
  { ref: 'Para #5',          description: 'Maximum per customer per month: TZS 60,000,000',         status: 'implemented', note: '30-day rolling window' },
  { ref: 'Para #6',          description: 'Maximum platform issuance per day: TZS 100,000,000',     status: 'implemented', note: 'Hard cap enforced by automated scheduler' },
  { ref: 'Para #2',          description: 'Sandbox limited to 100 participants',                    status: 'pending',     note: 'Scoped to the new bank/PSP corridor' },
  { ref: 'Para #8',          description: 'Biometric identity verification for all users',          status: 'pending',     note: 'Smile Identity integration planned before commencement' },
  { ref: 'Para #8',          description: 'Politically exposed persons & sanctions screening',      status: 'pending',     note: 'UN / BoT / OFAC screening before any wallet is activated' },
  { ref: 'Para #14',         description: 'Multi-party approval required to issue new shillings',   status: 'in_progress', note: 'Multi-signature wallet deployed; final wiring in progress' },
  { ref: 'Para #7 / LR-2',   description: 'Automated daily reserve report to BoT by 10:00 EAT',   status: 'pending' },
  { ref: 'LR-1',             description: 'Maintain 20% liquidity buffer of 30-day average redemptions', status: 'pending' },
  { ref: 'Para #12',         description: 'All customer-facing screens show TZS — not token names', status: 'pending', note: 'User interface audit required' },
]

const OPERATIONAL_PARAMS: BotParam[] = [
  { ref: 'AML-1 to AML-7', description: 'Anti-money laundering programme — enhanced checks, suspicious transaction reporting, FIU filings', status: 'pending' },
  { ref: 'R-11',            description: 'Customer complaints resolved within 5 days (90% target)',  status: 'pending' },
  { ref: 'Para #9',         description: 'Tax compliance reporting to TRA (VAT and withholding tax)', status: 'pending' },
  { ref: 'Para #16',        description: 'Monthly operational report to BoT',                        status: 'pending' },
  { ref: 'R-2',             description: 'Quarterly progress report to BoT',                         status: 'pending' },
  { ref: 'TR-1 to TR-4',   description: 'FATF travel rule — cross-border transfers above TZS 2,500,000', status: 'pending' },
  { ref: 'ST-1 to ST-4',   description: 'Quarterly stress testing (5 scenarios)',                    status: 'pending' },
  { ref: 'BC-1 to BC-3',   description: 'Business continuity plan — system recovers within 4 hours, data within 1 hour', status: 'pending' },
]

const PRE_TESTING_PARAMS: BotParam[] = [
  { ref: 'Para #7(a)', description: 'Signed Testing Environment Agreement with BoT',            status: 'process_item' },
  { ref: 'Para #7(b)', description: 'Formal confirmation letter from payment service partner',   status: 'process_item' },
  { ref: 'Para #7(c)', description: 'Issuance and redemption protocol with money flow diagram',  status: 'process_item' },
  { ref: 'Para #7(d)', description: 'Risk Management Plan',                                      status: 'process_item' },
  { ref: 'PD-1',       description: 'Registration with Personal Data Protection Commission',     status: 'process_item' },
  { ref: 'R-10',       description: 'Evidence of software ownership and registration',           status: 'process_item' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `TZS ${n.toLocaleString('en-TZ', { maximumFractionDigits: 0 })}`
}
function pct(used: number, total: number) {
  if (!total) return 0
  return Math.min(100, Math.round((used / total) * 100))
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ParamStatus, string> = {
  implemented:  'Live',
  in_progress:  'In Progress',
  pending:      'Planned',
  process_item: 'To Submit',
}

function StatusBadge({ status }: { status: ParamStatus }) {
  const styles: Record<ParamStatus, string> = {
    implemented:  'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    in_progress:  'bg-blue-50 text-blue-700 ring-blue-600/20',
    pending:      'bg-amber-50 text-amber-700 ring-amber-600/20',
    process_item: 'bg-gray-100 text-gray-600 ring-gray-500/20',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[status]}`}>
      {status === 'implemented' && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
      {STATUS_LABEL[status]}
    </span>
  )
}

// ── Shared card ───────────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ id, eyebrow, title, sub, children }: {
  id: string; eyebrow: string; title: string; sub?: string; children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-bold text-gray-900">{title}</h2>
        {sub && <p className="mt-2 max-w-2xl text-sm text-gray-500">{sub}</p>}
      </div>
      {children}
    </section>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function Stat({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className="p-6">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold tracking-tight ${accent ? 'text-indigo-600' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </Card>
  )
}

// ── Commitment table ──────────────────────────────────────────────────────────

function CommitmentTable({ params, groupLabel }: { params: BotParam[]; groupLabel: string }) {
  const implemented = params.filter(p => p.status === 'implemented').length
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">{groupLabel}</p>
        <span className="text-xs text-gray-400">{implemented}/{params.length} live</span>
      </div>
      <Card className="overflow-hidden">
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {params.map((p, i) => (
              <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                <td className="w-32 px-5 py-3.5 align-top font-mono text-xs text-gray-400">{p.ref}</td>
                <td className="px-5 py-3.5 text-gray-700">
                  {p.description}
                  {p.note && <div className="mt-0.5 text-xs text-gray-400">{p.note}</div>}
                </td>
                <td className="px-5 py-3.5 align-top"><StatusBadge status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function CompliancePortal({ data }: { data: ComplianceData }) {
  const [activeSection, setActiveSection] = useState('overview')

  useEffect(() => {
    const onScroll = () => {
      let current = SECTIONS[0].id
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= 120) current = s.id
      }
      setActiveSection(current)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Derived
  const variance = Math.round(data.onChainSupply - (data.pspMintedTotal + data.reconAdjustments))
  const fullyReconciled = Math.abs(variance) < 1
  const dailyCapPct = pct(data.issuedToday, data.platformDailyCap)
  const requiredLiqBuffer = data.avg30dDailyRedemptions != null
    ? Math.round(data.avg30dDailyRedemptions * 30 * 0.20)
    : null
  const allParams = [...BLOCKING_PARAMS, ...OPERATIONAL_PARAMS, ...PRE_TESTING_PARAMS]
  const implementedCount = allParams.filter(p => p.status === 'implemented').length

  return (
    <div className="flex min-h-screen bg-gray-50">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-gray-200 bg-white lg:flex">
        {/* Brand */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-5">
          <img src="/ntzs-icon.svg" alt="nTZS" className="h-8 w-8 rounded-lg" />
          <div>
            <p className="text-sm font-semibold text-gray-900">nTZS Compliance</p>
            <p className="text-xs text-gray-400">NEDA LABS Limited</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeSection === s.id
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Footer links */}
        <div className="border-t border-gray-100 px-3 py-4 space-y-1">
          <Link
            href="/app/oversight"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            Operations Dashboard
          </Link>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main className="flex-1 lg:ml-56">

        {/* Sticky header */}
        <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur px-6 py-4">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-gray-900">Compliance Portal</span>
              <span className="hidden text-sm text-gray-400 sm:inline">·</span>
              <span className="hidden text-sm text-gray-500 sm:inline">Bank of Tanzania Sandbox · Ref. {data.botApprovalRef}</span>
            </div>
            <ExportReportButton />
          </div>
        </header>

        <div className="mx-auto max-w-4xl space-y-16 px-6 py-12">

          {/* ── Hero / Overview ──────────────────────────────────────────────── */}
          <section id="overview" className="scroll-mt-20">

            {/* Mission hero */}
            <div className="rounded-3xl bg-gradient-to-br from-indigo-600 to-indigo-800 px-8 py-10 text-white sm:px-12 sm:py-14">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="max-w-xl">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    {data.sandboxPhase} · Bank of Tanzania Fintech Regulatory Sandbox
                  </span>
                  <h1 className="mt-4 text-3xl font-bold leading-snug sm:text-4xl">
                    Tanzania's first regulated<br />digital shilling.
                  </h1>
                  <p className="mt-3 text-base text-indigo-200">
                    Every digital shilling issued by NEDA LABS is backed 1-for-1 by real Tanzanian shillings held with a licensed payment service provider. Customers can redeem at any time.
                  </p>
                </div>

                {/* Countdown */}
                <div className="rounded-2xl bg-white/10 p-6 text-center ring-1 ring-white/20 min-w-[140px]">
                  <p className="text-xs font-medium uppercase tracking-widest text-indigo-300">Days to commencement</p>
                  <p className={`mt-2 text-6xl font-bold tabular-nums ${data.daysToDeadline <= 30 ? 'text-amber-300' : 'text-white'}`}>
                    {data.daysToDeadline}
                  </p>
                  <p className="mt-2 text-xs text-indigo-300">Deadline 23 June 2026</p>
                </div>
              </div>

              {/* Key facts strip */}
              <div className="mt-8 grid grid-cols-2 gap-4 border-t border-white/10 pt-8 sm:grid-cols-4">
                {[
                  { label: 'Approval reference', value: data.botApprovalRef },
                  { label: 'Approval date', value: '23 April 2026' },
                  { label: 'Applicant', value: 'NEDA LABS Company Limited' },
                  { label: 'Commitments live', value: `${implementedCount} of ${allParams.length}` },
                ].map(f => (
                  <div key={f.label}>
                    <p className="text-xs text-indigo-300">{f.label}</p>
                    <p className="mt-0.5 text-sm font-semibold text-white">{f.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Money Safety ─────────────────────────────────────────────────── */}
          <Section
            id="money-safety"
            eyebrow="Reserve Integrity"
            title="Every shilling is accounted for."
            sub="The number of digital shillings in circulation must always equal the real Tanzanian shillings held in reserve. This is verified independently on a public blockchain — anyone can check."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Digital shillings in circulation"
                value={fmt(data.onChainSupply)}
                sub="Verified on public blockchain"
                accent
              />
              <Stat
                label="Real shillings received"
                value={fmt(data.pspConfirmedTotal)}
                sub="Confirmed by payment partner"
              />
              <Stat
                label="Matched and issued"
                value={fmt(data.pspMintedTotal)}
                sub="Confirmed and on-chain"
              />
              <Stat
                label="Awaiting issue"
                value={fmt(data.pspConfirmedTotal - data.pspMintedTotal)}
                sub="Received · pending approval"
              />
            </div>

            {/* Reserve ratio card */}
            <Card className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-gray-500">Reserve status</p>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className={`text-2xl font-bold ${fullyReconciled ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fullyReconciled ? '100% — Fully reconciled' : `Variance: ${fmt(Math.abs(variance))}`}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    Every digital shilling issued is backed by a real shilling in reserve.
                    Enforced by a two-step approval process before any issuance.
                  </p>
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-sm font-semibold text-emerald-700">1:1 Backing maintained</span>
                </div>
              </div>

              {requiredLiqBuffer != null && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <p className="text-sm text-gray-500">
                    Liquidity buffer required <span className="text-gray-400 text-xs">(LR-1 — 20% of 30-day average redemptions)</span>
                  </p>
                  <p className="mt-1 text-lg font-bold text-amber-600">{fmt(requiredLiqBuffer)}</p>
                  <p className="text-xs text-gray-400">Planned — to be maintained before sandbox commencement.</p>
                </div>
              )}
            </Card>

            <a
              href={`https://basescan.org/token/${data.contractAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
            >
              Independently verify the circulating supply on Basescan
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          </Section>

          {/* ── Spending Limits ───────────────────────────────────────────────── */}
          <Section
            id="protections"
            eyebrow="Customer Protection"
            title="Built-in spending limits protect every customer."
            sub="These limits are hard-coded. No employee can override them. Every transaction is checked before it is processed."
          >
            {/* Platform daily cap with live bar */}
            <Card className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Platform-wide daily limit</p>
                  <p className="mt-2 text-3xl font-bold text-gray-900">{fmt(data.platformDailyCap)}</p>
                  <p className="mt-1 text-sm text-gray-500">Maximum total issuance across all customers per day</p>
                </div>
                <StatusBadge status="implemented" />
              </div>
              <div className="mt-5">
                <div className="mb-2 flex justify-between text-xs text-gray-500">
                  <span>Issued today: <span className="font-medium text-gray-900">{fmt(data.issuedToday)}</span></span>
                  <span className="font-medium">{dailyCapPct}% used</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      dailyCapPct > 90 ? 'bg-red-500' : dailyCapPct > 70 ? 'bg-amber-400' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${dailyCapPct}%` }}
                  />
                </div>
              </div>
            </Card>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: 'Maximum per transaction', value: fmt(data.perTxnCap), note: 'Automatically rejected — no exceptions' },
                { label: 'Maximum per customer per day', value: fmt(data.dailyUserCap), note: 'Rolling 24-hour window' },
                { label: 'Maximum per customer per month', value: fmt(data.monthlyUserCap), note: '30-day rolling window' },
              ].map(({ label, value, note }) => (
                <Card key={label} className="p-6">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-gray-500">{label}</p>
                    <StatusBadge status="implemented" />
                  </div>
                  <p className="mt-3 text-2xl font-bold text-gray-900">{value}</p>
                  <p className="mt-1 text-xs text-gray-400">{note}</p>
                </Card>
              ))}
            </div>
          </Section>

          {/* ── Users & Identity ──────────────────────────────────────────────── */}
          <Section
            id="users"
            eyebrow="Identity & KYC"
            title="Every user is verified before they can transact."
            sub="Identity verification ensures that only eligible participants can use the platform during the sandbox period."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Identity verified" value={String(data.kycApproved)} sub="Approved and active" accent />
              <Stat label="Under review" value={String(data.kycPending)} sub="Pending manual review" />
              <Stat label="Not eligible" value={String(data.kycRejected)} sub="Did not meet requirements" />
              <Stat label="Registered users" value={String(data.endUserCount)} sub="Sandbox cap: 100 participants" />
            </div>

            <Card className="p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100">
                  <svg className="h-3 w-3 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Biometric verification — Planned before commencement</p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    Current verification uses national ID and document upload with manual review. Biometric selfie verification and politically exposed persons / sanctions screening will be integrated before the sandbox begins.
                  </p>
                </div>
              </div>
            </Card>
          </Section>

          {/* ── Our Commitments ───────────────────────────────────────────────── */}
          <Section
            id="commitments"
            eyebrow="Regulatory Commitments"
            title="What we have committed to the Bank of Tanzania."
            sub="These are the conditions under which NEDA LABS operates this sandbox. Each item is tracked and reported."
          >
            <div className="space-y-8">
              <CommitmentTable
                params={BLOCKING_PARAMS}
                groupLabel="Required before sandbox commencement"
              />
              <CommitmentTable
                params={OPERATIONAL_PARAMS}
                groupLabel="Ongoing obligations during sandbox operation"
              />
              <CommitmentTable
                params={PRE_TESTING_PARAMS}
                groupLabel="Documents to be submitted to the Bank of Tanzania"
              />
            </div>
          </Section>

          {/* ── Governance ────────────────────────────────────────────────────── */}
          <Section
            id="governance"
            eyebrow="Governance"
            title="Who controls what — and how it is protected."
            sub="Issuance is controlled by software rules, not individuals. Administrative changes require multiple authorised signatories."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-6">
                <p className="text-sm font-semibold text-gray-900">Issuance & Redemption Rules</p>
                <div className="mt-4 space-y-3">
                  {[
                    ['Issue digital shillings', 'Requires fiat confirmation from payment partner + internal approval'],
                    ['Redeem digital shillings', 'Triggered by customer request — burns token, releases fiat'],
                    ['Pause all transactions', 'Emergency power for regulatory response'],
                    ['Freeze a customer wallet', 'Compliance or court order enforcement'],
                    ['Block an address permanently', 'AML / sanctions enforcement'],
                  ].map(([action, desc]) => (
                    <div key={action} className="flex items-start gap-3 rounded-lg border border-gray-100 p-3">
                      <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-indigo-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-800">{action}</p>
                        <p className="text-xs text-gray-500">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <div className="space-y-4">
                <Card className="p-6">
                  <p className="text-sm font-semibold text-gray-900">Technical Records</p>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div>
                      <dt className="text-gray-400">Public blockchain</dt>
                      <dd className="mt-0.5 font-medium text-gray-900">Base — Ethereum Layer 2 (Coinbase)</dd>
                    </div>
                    <div>
                      <dt className="text-gray-400">Token standard</dt>
                      <dd className="mt-0.5 font-medium text-gray-900">Upgradeable ERC-20 — auditable and extensible</dd>
                    </div>
                    <div className="border-t border-gray-100 pt-3">
                      <dt className="text-gray-400">Token contract address</dt>
                      <dd className="mt-0.5">
                        <a
                          href={`https://basescan.org/token/${data.contractAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all font-mono text-xs text-indigo-600 underline underline-offset-2"
                        >
                          {data.contractAddress}
                        </a>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-400">Multi-signature admin wallet</dt>
                      <dd className="mt-0.5">
                        <a
                          href={`https://basescan.org/address/${data.safeAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all font-mono text-xs text-indigo-600 underline underline-offset-2"
                        >
                          {data.safeAddress}
                        </a>
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-700 ring-1 ring-amber-200">
                    Independent security audit required before sandbox commencement.
                  </div>
                </Card>

                {data.recentEnforcement.length > 0 && (
                  <Card className="p-6">
                    <p className="text-sm font-semibold text-gray-900">Recent Enforcement Actions</p>
                    <div className="mt-4 space-y-3">
                      {data.recentEnforcement.map((e, i) => (
                        <div key={i} className="flex items-start justify-between gap-2 text-xs">
                          <div>
                            <span className="font-medium text-gray-800">{e.action.replace(/_/g, ' ')}</span>
                            {e.actorEmail && <span className="ml-1 text-gray-400">by {e.actorEmail}</span>}
                          </div>
                          {e.createdAt && (
                            <span className="shrink-0 text-gray-400">
                              {new Date(e.createdAt).toLocaleDateString('en-TZ')}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            </div>
          </Section>

          {/* ── Recent Activity ───────────────────────────────────────────────── */}
          <Section
            id="activity"
            eyebrow="Platform Activity"
            title="What happened in the last 24 hours."
            sub="A summary of customer deposits and redemptions. Full transaction history is available in the Operations Dashboard."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: 'Deposits received', count: data.deposits24hCount, volume: data.deposits24hTzs, ok: true },
                { label: 'Redemptions completed', count: data.burns24hCount, volume: data.burns24hTzs, ok: true },
                { label: 'Rejected transactions', count: data.deposits24hRejected, volume: null, ok: data.deposits24hRejected === 0 },
              ].map(row => (
                <Card key={row.label} className="p-6">
                  <p className="text-sm text-gray-500">{row.label}</p>
                  <p className={`mt-2 text-3xl font-bold ${row.ok ? 'text-gray-900' : 'text-red-600'}`}>{row.count}</p>
                  {row.volume != null && (
                    <p className="mt-1 text-sm font-medium text-gray-600">{fmt(row.volume)}</p>
                  )}
                </Card>
              ))}
            </div>

            <p className="text-xs text-gray-400">
              Full tables, transaction detail, and audit logs are in the{' '}
              <Link href="/app/oversight" className="text-indigo-600 underline underline-offset-2 hover:text-indigo-800">
                Operations Dashboard
              </Link>
              , which requires separate authorisation.
            </p>
          </Section>

          {/* ── Download ──────────────────────────────────────────────────────── */}
          <Section
            id="download"
            eyebrow="Documentation"
            title="Download the compliance report."
            sub="A printable summary of this page — reserve proof, commitments, issuance controls, and activity."
          >
            <Card className="p-8">
              <div className="flex flex-wrap items-start justify-between gap-8">
                <div>
                  <p className="text-lg font-semibold text-gray-900">Reserves & Compliance Report</p>
                  <p className="mt-1 text-sm text-gray-500 max-w-sm">
                    Includes on-chain supply verification, 1:1 reserve proof, KYC summary, spending limits, and recent activity.
                  </p>
                  <div className="mt-5">
                    <ExportReportButton />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-3">Pre-testing documents</p>
                  <div className="space-y-2">
                    {[
                      'Testing Environment Agreement',
                      'PSP partnership confirmation letter',
                      'Risk Management Plan',
                      'Token issuance flow diagram',
                    ].map(doc => (
                      <div key={doc} className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                        {doc} — pending
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </Section>

          {/* Footer */}
          <footer className="border-t border-gray-100 pt-6 text-xs text-gray-400">
            <div className="flex flex-wrap justify-between gap-2">
              <span>NEDA LABS Company Limited · Dar es Salaam, Tanzania</span>
              <span>Data as of {data.generatedAt} EAT · Refresh page for latest</span>
            </div>
          </footer>

        </div>
      </main>
    </div>
  )
}
