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
  recentEnforcement: Array<{
    action: string
    actorEmail: string | null
    createdAt: string | null
  }>
  avg30dDailyRedemptions: number | null
}

type ParamStatus = 'implemented' | 'in_progress' | 'pending' | 'process_item'

interface BotParam {
  ref: string
  description: string
  status: ParamStatus
  note?: string
}

// ── Nav sections ──────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'reserves', label: 'Reserve Integrity' },
  { id: 'issuance', label: 'Issuance Controls' },
  { id: 'kyc', label: 'KYC & Users' },
  { id: 'parameters', label: 'BoT Parameters' },
  { id: 'governance', label: 'Governance' },
  { id: 'activity', label: 'Activity' },
  { id: 'export', label: 'Export' },
]

// ── BoT compliance declarations ───────────────────────────────────────────────

const BLOCKING_PARAMS: BotParam[] = [
  { ref: 'Para #3', description: 'Per-transaction cap (TZS 1,000,000)', status: 'implemented', note: 'Enforced in all deposit, burn and transfer APIs' },
  { ref: 'Para #4', description: 'Daily per-user limit (TZS 2,000,000)', status: 'implemented', note: 'Rolling 24-hour sum across deposits and burns' },
  { ref: 'Para #5', description: 'Monthly per-user cap (TZS 60,000,000)', status: 'implemented', note: '30-day rolling window' },
  { ref: 'Para #6', description: 'Platform daily issuance cap (TZS 100,000,000)', status: 'implemented', note: 'dailyIssuance table enforced by worker cron' },
  { ref: 'Para #2', description: 'Sandbox user cap (100 participants)', status: 'pending', note: 'Scoped to new bank/PSP corridor — existing Snippe corridor unaffected' },
  { ref: 'Para #8', description: 'Biometric KYC + OTP verification', status: 'pending', note: 'Smile Identity integration planned' },
  { ref: 'Para #8', description: 'PEP screening + sanctions checks', status: 'pending', note: 'UN / BoT / OFAC screening required before wallet activation' },
  { ref: 'Para #14', description: 'Multi-signature minting keys (Gnosis Safe)', status: 'in_progress', note: 'Safe deployed; mint_requires_safe flow pending full wiring' },
  { ref: 'Para #7 / LR-2', description: 'Automated daily reserve report to BoT at 10:00 EAT', status: 'pending' },
  { ref: 'LR-1', description: 'Operational liquidity buffer (20% of 30-day avg redemptions)', status: 'pending' },
  { ref: 'Para #12', description: 'TZS-only display to end users — no nTZS terminology', status: 'pending', note: 'UI audit required' },
]

const OPERATIONAL_PARAMS: BotParam[] = [
  { ref: 'AML-1 to AML-7', description: 'AML/CFT programme (EDD, STR workflow, FIU reporting)', status: 'pending' },
  { ref: 'R-11', description: 'Consumer complaint SLA (90% resolved within 5 days)', status: 'pending' },
  { ref: 'Para #9', description: 'Tax compliance reporting (VAT/WHT + TRA)', status: 'pending' },
  { ref: 'Para #16', description: 'Monthly BoT operational report', status: 'pending' },
  { ref: 'R-2', description: 'Quarterly BoT progress report', status: 'pending' },
  { ref: 'TR-1 to TR-4', description: 'FATF Travel Rule — cross-border transfers above TZS 2,500,000', status: 'pending' },
  { ref: 'ST-1 to ST-4', description: 'Quarterly stress testing framework (5 scenarios)', status: 'pending' },
  { ref: 'BC-1 to BC-3', description: 'BCP/DR documentation (RTO 4 hours, RPO 1 hour)', status: 'pending' },
]

const PRE_TESTING_PARAMS: BotParam[] = [
  { ref: 'Para #7(a)', description: 'Executed Testing Environment Agreement', status: 'process_item' },
  { ref: 'Para #7(b)', description: 'Formal PSP partnership confirmation letter', status: 'process_item' },
  { ref: 'Para #7(c)', description: 'nTZS issuance/redemption protocol + token flow diagram', status: 'process_item' },
  { ref: 'Para #7(d)', description: 'Risk Management Plan (including fake e-money creation risk)', status: 'process_item' },
  { ref: 'PD-1', description: 'Register with Personal Data Protection Commission', status: 'process_item' },
  { ref: 'R-10', description: 'Evidence of IP ownership and smart contract registration', status: 'process_item' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `TZS ${n.toLocaleString('en-TZ', { maximumFractionDigits: 0 })}`
}

function fmtShort(n: number) {
  if (n >= 1_000_000) return `TZS ${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `TZS ${(n / 1_000).toFixed(1)}K`
  return fmt(n)
}

function pct(used: number, total: number) {
  if (!total) return 0
  return Math.min(100, Math.round((used / total) * 100))
}

// ── Sub-components ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ParamStatus, string> = {
  implemented: 'Implemented',
  in_progress: 'In Progress',
  pending: 'Pending',
  process_item: 'Process Item',
}

function StatusBadge({ status, dark }: { status: ParamStatus; dark: boolean }) {
  const light: Record<ParamStatus, string> = {
    implemented: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    in_progress: 'bg-sky-50 text-sky-700 border-sky-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    process_item: 'bg-gray-100 text-gray-600 border-gray-200',
  }
  const dk: Record<ParamStatus, string> = {
    implemented: 'bg-emerald-950 text-emerald-400 border-emerald-900',
    in_progress: 'bg-sky-950 text-sky-400 border-sky-900',
    pending: 'bg-amber-950 text-amber-400 border-amber-900',
    process_item: 'bg-gray-800 text-gray-400 border-gray-700',
  }
  const dotColor: Record<ParamStatus, string> = {
    implemented: 'bg-emerald-500',
    in_progress: 'bg-sky-500',
    pending: 'bg-amber-500',
    process_item: 'bg-gray-400',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${dark ? dk[status] : light[status]}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

function MetricCard({
  label,
  value,
  sub,
  accent,
  dark,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'green' | 'red' | 'amber' | 'blue' | 'none'
  dark: boolean
}) {
  const accentBar: Record<string, string> = {
    green: 'border-l-emerald-500',
    red: 'border-l-red-500',
    amber: 'border-l-amber-500',
    blue: 'border-l-sky-500',
    none: dark ? 'border-l-gray-700' : 'border-l-gray-200',
  }
  const cardBase = dark
    ? 'bg-gray-900 border-gray-800'
    : 'bg-white border-gray-200'
  return (
    <div className={`rounded-lg border border-l-4 ${cardBase} ${accentBar[accent ?? 'none']} p-5 shadow-sm`}>
      <div className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
        {label}
      </div>
      <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${dark ? 'text-gray-100' : 'text-gray-900'}`}>
        {value}
      </div>
      {sub && (
        <div className={`mt-1 text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{sub}</div>
      )}
    </div>
  )
}

function SectionHeader({
  id,
  title,
  subtitle,
  dark,
}: {
  id: string
  title: string
  subtitle?: string
  dark: boolean
}) {
  return (
    <div id={id} className={`border-t pt-10 ${dark ? 'border-gray-800' : 'border-gray-200'}`}>
      <h2 className={`text-lg font-semibold tracking-tight ${dark ? 'text-gray-100' : 'text-gray-900'}`}>
        {title}
      </h2>
      {subtitle && (
        <p className={`mt-1 text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{subtitle}</p>
      )}
    </div>
  )
}

function ParamGroup({
  title,
  accentClass,
  params,
  dark,
}: {
  title: string
  accentClass: string
  params: BotParam[]
  dark: boolean
}) {
  const card = dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
  const headBg = dark ? 'bg-gray-800' : 'bg-gray-50'
  const rowDiv = dark ? 'divide-gray-800' : 'divide-gray-100'
  const refColor = dark ? 'text-gray-400' : 'text-gray-500'
  const descColor = dark ? 'text-gray-200' : 'text-gray-700'
  const noteColor = dark ? 'text-gray-500' : 'text-gray-400'
  return (
    <div>
      <div className={`mb-3 flex items-center gap-2`}>
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${accentClass}`} />
        <span className={`text-xs font-semibold uppercase tracking-widest ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
          {title}
        </span>
      </div>
      <div className={`overflow-hidden rounded-lg border ${card}`}>
        <table className="min-w-full divide-y text-sm">
          <thead>
            <tr className={headBg}>
              <th className={`w-28 px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                Reference
              </th>
              <th className={`px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                Requirement
              </th>
              <th className={`w-36 px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                Status
              </th>
            </tr>
          </thead>
          <tbody className={`divide-y ${rowDiv}`}>
            {params.map((p, i) => (
              <tr key={i} className={`transition-colors ${dark ? 'hover:bg-gray-800/40' : 'hover:bg-gray-50/60'}`}>
                <td className={`px-4 py-3 align-top font-mono text-xs ${refColor}`}>{p.ref}</td>
                <td className={`px-4 py-3 ${descColor}`}>
                  {p.description}
                  {p.note && <div className={`mt-0.5 text-xs ${noteColor}`}>{p.note}</div>}
                </td>
                <td className="px-4 py-3 align-top">
                  <StatusBadge status={p.status} dark={dark} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function CompliancePortal({ data }: { data: ComplianceData }) {
  const [isDark, setIsDark] = useState(false)
  const [activeSection, setActiveSection] = useState('overview')

  useEffect(() => {
    const saved = localStorage.getItem('compliance-theme')
    if (saved === 'dark') setIsDark(true)
  }, [])

  useEffect(() => {
    const onScroll = () => {
      const offset = 100
      let current = SECTIONS[0].id
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= offset) current = s.id
      }
      setActiveSection(current)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function toggleTheme() {
    const next = !isDark
    setIsDark(next)
    localStorage.setItem('compliance-theme', next ? 'dark' : 'light')
  }

  function scrollTo(id: string) {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Derived values
  const pspPending = data.pspConfirmedTotal - data.pspMintedTotal
  const variance = Math.round(data.onChainSupply - (data.pspMintedTotal + data.reconAdjustments))
  const fullyReconciled = Math.abs(variance) < 1
  const dailyCapPct = pct(data.issuedToday, data.platformDailyCap)
  const requiredLiqBuffer = data.avg30dDailyRedemptions != null
    ? Math.round(data.avg30dDailyRedemptions * 30 * 0.20)
    : null

  // Theme helpers
  const d = isDark
  const root = d ? 'bg-gray-950 text-gray-100' : 'bg-gray-50 text-gray-900'
  const sidebar = d ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
  const card = d ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
  const muted = d ? 'text-gray-400' : 'text-gray-500'
  const faint = d ? 'text-gray-500' : 'text-gray-400'
  const divider = d ? 'border-gray-800' : 'border-gray-200'
  const heading = d ? 'text-gray-100' : 'text-gray-900'
  const body = d ? 'text-gray-300' : 'text-gray-600'
  const tableHead = d ? 'bg-gray-800' : 'bg-gray-50'
  const tableDiv = d ? 'divide-gray-800' : 'divide-gray-100'

  return (
    <div className={`flex min-h-screen ${root}`}>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className={`fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r lg:flex ${sidebar}`}>
        {/* Logo + title */}
        <div className={`border-b px-5 py-5 ${divider}`}>
          <div className={`text-sm font-bold tracking-tight ${heading}`}>nTZS Compliance</div>
          <div className={`mt-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${faint}`}>
            NEDA LABS Limited
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className={`mb-1 px-2 text-[9px] font-semibold uppercase tracking-[0.12em] ${faint}`}>
            Sections
          </div>
          {SECTIONS.map(s => {
            const isActive = activeSection === s.id
            const activeStyle = d
              ? 'bg-indigo-900/40 text-indigo-300'
              : 'bg-indigo-50 text-indigo-700 font-semibold'
            const idleStyle = d
              ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${isActive ? activeStyle : idleStyle}`}
              >
                {isActive && (
                  <span className="h-1 w-1 rounded-full bg-indigo-500 shrink-0" />
                )}
                {!isActive && <span className="h-1 w-1 rounded-full opacity-0 shrink-0" />}
                {s.label}
              </button>
            )
          })}

          <div className={`my-4 border-t ${divider}`} />

          <Link
            href="/app/oversight"
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${d ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}
          >
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            Oversight Dashboard
          </Link>
        </nav>

        {/* Footer: theme + metadata */}
        <div className={`border-t px-5 py-4 ${divider}`}>
          <button
            onClick={toggleTheme}
            className={`mb-3 flex w-full items-center justify-between rounded-md px-3 py-2 text-xs transition-colors ${d ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            <span>{d ? 'Dark mode' : 'Light mode'}</span>
            <span className={`inline-flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${d ? 'bg-indigo-600 justify-end' : 'bg-gray-300 justify-start'}`}>
              <span className="h-3 w-3 rounded-full bg-white shadow-sm" />
            </span>
          </button>
          <div className={`text-[10px] leading-relaxed ${faint}`}>
            <div>BoT Sandbox Ref.</div>
            <div className="font-mono">{data.botApprovalRef}</div>
            <div className="mt-1">{data.generatedAt} EAT</div>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="flex-1 min-h-screen lg:ml-60">
        {/* Top bar (mobile + desktop) */}
        <div className={`sticky top-0 z-20 border-b px-6 py-4 lg:py-3 ${d ? 'bg-gray-950/90 border-gray-800 backdrop-blur' : 'bg-gray-50/90 border-gray-200 backdrop-blur'}`}>
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <div>
              <span className={`text-sm font-semibold ${heading}`}>
                nTZS Compliance Portal
              </span>
              <span className={`ml-2 hidden text-xs sm:inline ${muted}`}>
                Bank of Tanzania Fintech Regulatory Sandbox
              </span>
            </div>
            <div className="flex items-center gap-3">
              <ExportReportButton />
              {/* Mobile theme toggle */}
              <button
                onClick={toggleTheme}
                className={`flex h-8 w-8 items-center justify-center rounded-md lg:hidden ${d ? 'bg-gray-800 text-gray-300' : 'bg-gray-200 text-gray-600'}`}
                aria-label="Toggle theme"
              >
                {d ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-4xl space-y-12 px-6 py-10">

          {/* ── Section: Overview (sandbox status) ──────────────────────── */}
          <div id="overview">
            <div className={`rounded-xl border p-6 ${
              data.daysToDeadline <= 14
                ? d ? 'border-red-900 bg-red-950/30' : 'border-red-200 bg-red-50'
                : data.daysToDeadline <= 30
                ? d ? 'border-amber-900 bg-amber-950/30' : 'border-amber-200 bg-amber-50'
                : d ? 'border-indigo-900 bg-indigo-950/20' : 'border-indigo-200 bg-indigo-50'
            }`}>
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      data.daysToDeadline > 0
                        ? d ? 'bg-amber-900/50 text-amber-300' : 'bg-amber-100 text-amber-800'
                        : d ? 'bg-emerald-900/50 text-emerald-300' : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {data.sandboxPhase}
                    </span>
                    <span className={`text-xs ${faint}`}>Bank of Tanzania Fintech Regulatory Sandbox</span>
                  </div>
                  <div className={`mt-3 space-y-1 text-sm ${body}`}>
                    <div>
                      <span className={faint}>Approval reference</span>{' '}
                      <span className="font-mono font-medium">{data.botApprovalRef}</span>
                    </div>
                    <div>
                      <span className={faint}>Approved</span>{' '}
                      <span className="font-medium">23 April 2026</span>
                    </div>
                    <div>
                      <span className={faint}>Commencement deadline</span>{' '}
                      <span className="font-medium">23 June 2026</span>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-mono text-5xl font-bold tabular-nums ${heading}`}>
                    {data.daysToDeadline}
                  </div>
                  <div className={`mt-1 text-xs ${muted}`}>days to commencement deadline</div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Section: Reserve Integrity ───────────────────────────────── */}
          <div>
            <SectionHeader
              id="reserves"
              title="Reserve Integrity"
              subtitle="PSP-confirmed fiat receipts (Snippe, Base mainnet) versus on-chain token supply. On-chain totalSupply() is the authoritative circulation figure."
              dark={isDark}
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
              <MetricCard
                label="On-chain supply — authoritative"
                value={fmtShort(data.onChainSupply)}
                sub={`Base mainnet totalSupply() · ${fmt(data.onChainSupply)}`}
                accent="blue"
                dark={isDark}
              />
              <MetricCard
                label="PSP-confirmed fiat received (Snippe)"
                value={fmtShort(data.pspConfirmedTotal)}
                sub={`Total Snippe webhook-confirmed deposits · ${fmt(data.pspConfirmedTotal)}`}
                accent="none"
                dark={isDark}
              />
              <MetricCard
                label="Minted from PSP receipts"
                value={fmtShort(data.pspMintedTotal)}
                sub={`Snippe-confirmed and minted on-chain · ${fmt(data.pspMintedTotal)}`}
                accent="green"
                dark={isDark}
              />
              <MetricCard
                label="In pipeline (PSP confirmed, not yet minted)"
                value={fmtShort(pspPending)}
                sub={`Awaiting bank + platform approval · ${fmt(pspPending)}`}
                accent={pspPending > 0 ? 'amber' : 'none'}
                dark={isDark}
              />
            </div>

            {/* Reconciliation row */}
            <div className={`mt-4 rounded-lg border p-4 text-sm ${card}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <span className={`font-medium ${heading}`}>Variance (on-chain vs PSP minted + reconciliation)</span>
                  <div className={`mt-0.5 text-xs ${faint}`}>
                    Reconciliation adjustments: {fmt(data.reconAdjustments)} (opening balance, corrections)
                  </div>
                </div>
                <div className={`shrink-0 font-mono text-lg font-bold tabular-nums ${fullyReconciled ? 'text-emerald-500' : 'text-red-500'}`}>
                  {fullyReconciled ? 'TZS 0 — reconciled' : `${variance > 0 ? '+' : ''}${fmt(Math.abs(variance))}`}
                </div>
              </div>
              {!fullyReconciled && (
                <div className={`mt-2 text-xs ${d ? 'text-red-400' : 'text-red-600'}`}>
                  {variance > 0
                    ? 'On-chain supply exceeds PSP-minted total — investigate for untracked mints or reconciliation entries'
                    : 'PSP-minted total exceeds on-chain supply — investigate for failed mint transactions'}
                </div>
              )}
            </div>

            {/* Reserve ratio + liquidity buffer */}
            <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm ${card}`}>
              <div>
                <span className={`font-medium ${heading}`}>Reserve ratio</span>
                <span className="ml-2 font-semibold text-emerald-500">
                  100% — enforced by dual-approval mint workflow
                </span>
                <div className={`mt-0.5 text-xs ${faint}`}>
                  Every nTZS token is minted only after bank and platform confirmation of TZS fiat receipt.
                </div>
              </div>
              <div className={`text-sm ${body}`}>
                <span className={`font-medium ${heading}`}>Liquidity buffer (LR-1)</span>
                {requiredLiqBuffer != null ? (
                  <span className="ml-2 text-amber-500 font-semibold">
                    Required: {fmt(requiredLiqBuffer)} (20% × 30-day avg redemptions)
                  </span>
                ) : (
                  <span className={`ml-2 italic ${faint}`}>Insufficient redemption history (&lt; 30 days)</span>
                )}
              </div>
            </div>

            <div className="mt-3 flex gap-4">
              <a
                href={`https://basescan.org/token/${data.contractAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-xs underline underline-offset-2 transition-colors ${d ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
              >
                Verify supply independently at Basescan
              </a>
            </div>
          </div>

          {/* ── Section: Issuance Controls ───────────────────────────────── */}
          <div>
            <SectionHeader
              id="issuance"
              title="Issuance Controls"
              subtitle="All transaction limits are enforced at the API layer (lib/sandbox/limits.ts) with full audit trail on every transaction."
              dark={isDark}
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {/* Platform daily cap — live utilization */}
              <div className={`rounded-lg border p-5 shadow-sm ${card}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${faint}`}>
                    Para #6 — Platform daily cap
                  </span>
                  <span className={`rounded border px-2 py-0.5 text-xs font-medium ${d ? 'border-emerald-900 bg-emerald-950 text-emerald-400' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                    Enforced
                  </span>
                </div>
                <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${heading}`}>
                  {fmt(data.platformDailyCap)}
                </div>
                <div className="mt-3">
                  <div className={`mb-1 flex justify-between text-xs ${muted}`}>
                    <span>Issued today: {fmt(data.issuedToday)}</span>
                    <span>{dailyCapPct}%</span>
                  </div>
                  <div className={`h-1.5 overflow-hidden rounded-full ${d ? 'bg-gray-800' : 'bg-gray-100'}`}>
                    <div
                      className={`h-full rounded-full transition-all ${dailyCapPct > 90 ? 'bg-red-500' : dailyCapPct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${dailyCapPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {[
                { ref: 'Para #3', label: 'Per-transaction cap', limit: data.perTxnCap, note: 'Hard-rejected at API layer — no exceptions' },
                { ref: 'Para #4', label: 'Daily per-user limit', limit: data.dailyUserCap, note: 'Rolling 24-hour window across deposits and burns' },
                { ref: 'Para #5', label: 'Monthly per-user cap', limit: data.monthlyUserCap, note: '30-day rolling window across deposits and burns' },
              ].map(({ ref, label, limit, note }) => (
                <div key={ref} className={`rounded-lg border p-5 shadow-sm ${card}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${faint}`}>
                      {ref} — {label}
                    </span>
                    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${d ? 'border-emerald-900 bg-emerald-950 text-emerald-400' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                      Enforced
                    </span>
                  </div>
                  <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${heading}`}>
                    {fmt(limit)}
                  </div>
                  <div className={`mt-2 text-xs ${faint}`}>{note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Section: KYC & Users ─────────────────────────────────────── */}
          <div>
            <SectionHeader
              id="kyc"
              title="KYC & User Overview"
              subtitle="Identity verification status and registered participant summary."
              dark={isDark}
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="KYC Approved" value={String(data.kycApproved)} accent="green" dark={isDark} />
              <MetricCard label="KYC Pending review" value={String(data.kycPending)} accent={data.kycPending > 0 ? 'amber' : 'none'} dark={isDark} />
              <MetricCard label="KYC Rejected" value={String(data.kycRejected)} accent="none" dark={isDark} />
              <MetricCard
                label="Registered end users"
                value={String(data.endUserCount)}
                sub="Sandbox cap (100) applies to new bank/PSP corridor"
                accent="none"
                dark={isDark}
              />
            </div>
            <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${d ? 'border-amber-900 bg-amber-950/20 text-amber-300' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              <strong>Para #8 — Pending:</strong> Biometric selfie verification (Smile Identity) and PEP/sanctions screening
              are not yet integrated. Current KYC is national ID and document upload with manual review workflow.
            </div>
          </div>

          {/* ── Section: BoT Parameters ──────────────────────────────────── */}
          <div>
            <SectionHeader
              id="parameters"
              title="BoT Sandbox Parameter Compliance"
              subtitle="Status as of report date. Implemented denotes live code in production. Process Item denotes a documentation or registration task."
              dark={isDark}
            />
            <div className="mt-6 space-y-6">
              <ParamGroup
                title="Blocking — required before commencement"
                accentClass="bg-red-500"
                params={BLOCKING_PARAMS}
                dark={isDark}
              />
              <ParamGroup
                title="Required during sandbox operation"
                accentClass="bg-amber-500"
                params={OPERATIONAL_PARAMS}
                dark={isDark}
              />
              <ParamGroup
                title="Pre-testing documents to submit to BoT"
                accentClass="bg-sky-500"
                params={PRE_TESTING_PARAMS}
                dark={isDark}
              />
            </div>
          </div>

          {/* ── Section: Governance ──────────────────────────────────────── */}
          <div>
            <SectionHeader
              id="governance"
              title="Governance & Smart Contract"
              subtitle="On-chain contract details, role accountability, and recent enforcement actions."
              dark={isDark}
            />
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {/* Contract details */}
              <div className={`rounded-lg border p-5 shadow-sm ${card}`}>
                <h3 className={`mb-4 text-sm font-semibold ${heading}`}>Smart Contract</h3>
                <dl className="space-y-3 text-sm">
                  {[
                    { label: 'Network', value: 'Base Mainnet (Chain ID 8453)' },
                    { label: 'Contract type', value: 'NTZSV2 — UUPS upgradeable ERC-20' },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between gap-2">
                      <dt className={faint}>{label}</dt>
                      <dd className={`font-medium text-right ${body}`}>{value}</dd>
                    </div>
                  ))}
                  <div className={`flex flex-col gap-1 border-t pt-3 ${divider}`}>
                    <dt className={`text-xs ${faint}`}>Proxy address</dt>
                    <dd>
                      <a
                        href={`https://basescan.org/token/${data.contractAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`break-all font-mono text-xs underline underline-offset-2 ${d ? 'text-sky-400 hover:text-sky-300' : 'text-sky-600 hover:text-sky-700'}`}
                      >
                        {data.contractAddress}
                      </a>
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className={`text-xs ${faint}`}>Gnosis Safe (admin multi-sig)</dt>
                    <dd>
                      <a
                        href={`https://basescan.org/address/${data.safeAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`break-all font-mono text-xs underline underline-offset-2 ${d ? 'text-sky-400 hover:text-sky-300' : 'text-sky-600 hover:text-sky-700'}`}
                      >
                        {data.safeAddress}
                      </a>
                    </dd>
                  </div>
                  <div className={`rounded border px-3 py-2 text-xs ${d ? 'border-amber-900 bg-amber-950/20 text-amber-400' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    Third-party smart contract audit required before sandbox commencement.
                  </div>
                </dl>
              </div>

              {/* Roles + enforcement */}
              <div className="space-y-4">
                <div className={`rounded-lg border p-5 shadow-sm ${card}`}>
                  <h3 className={`mb-3 text-sm font-semibold ${heading}`}>Contract Roles</h3>
                  <table className="min-w-full text-xs">
                    <tbody className={`divide-y ${tableDiv}`}>
                      {[
                        ['MINTER_ROLE', 'Mint nTZS — requires prior fiat confirmation'],
                        ['BURNER_ROLE', 'Burn nTZS on redemption'],
                        ['PAUSER_ROLE', 'Emergency pause all transfers'],
                        ['FREEZER_ROLE', 'Freeze individual wallet address'],
                        ['BLACKLISTER_ROLE', 'Permanently block address'],
                        ['WIPER_ROLE', 'Burn balance of blacklisted address'],
                      ].map(([role, desc]) => (
                        <tr key={role}>
                          <td className={`py-1.5 pr-3 font-mono ${d ? 'text-gray-400' : 'text-gray-500'}`}>{role}</td>
                          <td className={`py-1.5 ${body}`}>{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {data.recentEnforcement.length > 0 && (
                  <div className={`rounded-lg border p-5 shadow-sm ${card}`}>
                    <h3 className={`mb-3 text-sm font-semibold ${heading}`}>Recent Enforcement Actions</h3>
                    <div className="space-y-2">
                      {data.recentEnforcement.map((e, i) => (
                        <div key={i} className="flex items-start justify-between gap-2 text-xs">
                          <div>
                            <span className={`font-medium ${heading}`}>
                              {e.action.replace(/_/g, ' ')}
                            </span>
                            {e.actorEmail && (
                              <span className={`ml-1 ${faint}`}>by {e.actorEmail}</span>
                            )}
                          </div>
                          {e.createdAt && (
                            <span className={`shrink-0 ${faint}`}>
                              {new Date(e.createdAt).toLocaleDateString('en-TZ')}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Section: Activity ────────────────────────────────────────── */}
          <div>
            <SectionHeader
              id="activity"
              title="Transaction Activity — Last 24 Hours"
              subtitle="Summary of deposit and redemption activity through the platform."
              dark={isDark}
            />
            <div className={`mt-6 overflow-hidden rounded-lg border ${card}`}>
              <table className="min-w-full divide-y text-sm">
                <thead>
                  <tr className={tableHead}>
                    <th className={`px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] ${faint}`}>Category</th>
                    <th className={`px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] ${faint}`}>Count</th>
                    <th className={`px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] ${faint}`}>Volume</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${tableDiv}`}>
                  <tr>
                    <td className={`px-5 py-3 ${body}`}>Deposits initiated (all statuses)</td>
                    <td className={`px-5 py-3 text-right font-mono tabular-nums ${heading}`}>{data.deposits24hCount}</td>
                    <td className={`px-5 py-3 text-right font-mono tabular-nums ${heading}`}>{fmt(data.deposits24hTzs)}</td>
                  </tr>
                  <tr>
                    <td className={`px-5 py-3 ${body}`}>Redemptions completed (burned on-chain)</td>
                    <td className={`px-5 py-3 text-right font-mono tabular-nums ${heading}`}>{data.burns24hCount}</td>
                    <td className={`px-5 py-3 text-right font-mono tabular-nums ${heading}`}>{fmt(data.burns24hTzs)}</td>
                  </tr>
                  <tr>
                    <td className={`px-5 py-3 ${body}`}>Rejected or failed deposits</td>
                    <td className={`px-5 py-3 text-right font-mono tabular-nums font-medium ${data.deposits24hRejected > 0 ? 'text-red-500' : heading}`}>
                      {data.deposits24hRejected}
                    </td>
                    <td className={`px-5 py-3 text-right ${faint}`}>—</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className={`mt-2 text-xs ${faint}`}>
              Full activity tables are available in the{' '}
              <Link href="/app/oversight" className={`underline underline-offset-2 ${d ? 'hover:text-gray-300' : 'hover:text-gray-600'}`}>
                Oversight Dashboard
              </Link>.
            </p>
          </div>

          {/* ── Section: Export ──────────────────────────────────────────── */}
          <div>
            <SectionHeader
              id="export"
              title="Export & Documents"
              subtitle="Download the compliance report or access submission documents for BoT."
              dark={isDark}
            />
            <div className={`mt-6 rounded-lg border p-6 shadow-sm ${card}`}>
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <div className={`text-sm font-semibold ${heading}`}>Reserves & Compliance Report (PDF)</div>
                  <div className={`mt-1 text-xs ${faint}`}>
                    Includes on-chain supply, reserve verification, KYC posture, issuance controls, and recent deposit activity.
                  </div>
                  <div className="mt-4">
                    <ExportReportButton />
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  <div className={`mb-2 font-semibold ${heading}`}>Pre-testing submission documents</div>
                  {[
                    'Testing Environment Agreement — pending execution',
                    'PSP partnership confirmation — pending',
                    'Risk Management Plan — pending',
                    'nTZS token flow diagram — pending',
                  ].map(doc => (
                    <div key={doc} className={`text-xs italic ${faint}`}>{doc}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className={`border-t pt-6 text-xs ${divider} ${faint}`}>
            <div className="flex flex-wrap justify-between gap-2">
              <span>NEDA LABS Company Limited · Dar es Salaam, Tanzania · nTZS Stablecoin Compliance Portal</span>
              <span>Data current as of {data.generatedAt} EAT · Refresh page for latest figures</span>
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
