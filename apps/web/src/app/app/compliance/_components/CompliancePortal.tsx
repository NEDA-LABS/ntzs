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
  { ref: 'Para #2', description: 'Sandbox user cap (100 participants)', status: 'pending', note: 'Scoped to new bank/PSP corridor' },
  { ref: 'Para #8', description: 'Biometric KYC + OTP verification', status: 'pending', note: 'Smile Identity integration planned' },
  { ref: 'Para #8', description: 'PEP screening + sanctions checks', status: 'pending', note: 'UN / BoT / OFAC screening before wallet activation' },
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
  const styles: Record<ParamStatus, { light: string; dk: string }> = {
    implemented: { light: 'bg-green-50 text-green-700', dk: 'bg-green-900/30 text-green-400' },
    in_progress:  { light: 'bg-blue-50 text-blue-700',  dk: 'bg-blue-900/30 text-blue-400'  },
    pending:      { light: 'bg-amber-50 text-amber-700', dk: 'bg-amber-900/30 text-amber-400' },
    process_item: { light: 'bg-gray-100 text-gray-500',  dk: 'bg-gray-800 text-gray-400'      },
  }
  const s = styles[status]
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${dark ? s.dk : s.light}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

function Card({ children, dark, className = '' }: { children: React.ReactNode; dark: boolean; className?: string }) {
  return (
    <div className={`rounded-xl border ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'} ${className}`}>
      {children}
    </div>
  )
}

function MetricCard({ label, value, sub, dark }: { label: string; value: string; sub?: string; dark: boolean }) {
  return (
    <Card dark={dark} className="p-6">
      <div className={`text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{label}</div>
      <div className={`mt-2 text-3xl font-bold tracking-tight ${dark ? 'text-white' : 'text-gray-900'}`}>{value}</div>
      {sub && <div className={`mt-1 text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{sub}</div>}
    </Card>
  )
}

function SectionTitle({ id, title, sub, dark }: { id: string; title: string; sub?: string; dark: boolean }) {
  return (
    <div id={id} className={`border-t pt-10 ${dark ? 'border-gray-800' : 'border-gray-100'}`}>
      <h2 className={`text-xl font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>{title}</h2>
      {sub && <p className={`mt-1 text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{sub}</p>}
    </div>
  )
}

function ParamTable({ params, dark }: { params: BotParam[]; dark: boolean }) {
  return (
    <Card dark={dark} className="overflow-hidden">
      <table className="min-w-full text-sm">
        <thead>
          <tr className={dark ? 'bg-gray-800/50' : 'bg-gray-50'}>
            <th className={`w-32 px-5 py-3 text-left text-xs font-medium ${dark ? 'text-gray-400' : 'text-gray-500'}`}>Ref</th>
            <th className={`px-5 py-3 text-left text-xs font-medium ${dark ? 'text-gray-400' : 'text-gray-500'}`}>Requirement</th>
            <th className={`w-32 px-5 py-3 text-left text-xs font-medium ${dark ? 'text-gray-400' : 'text-gray-500'}`}>Status</th>
          </tr>
        </thead>
        <tbody className={`divide-y ${dark ? 'divide-gray-800' : 'divide-gray-100'}`}>
          {params.map((p, i) => (
            <tr key={i} className={dark ? 'hover:bg-gray-800/30' : 'hover:bg-gray-50/80'}>
              <td className={`px-5 py-3 align-top font-mono text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{p.ref}</td>
              <td className={`px-5 py-3 ${dark ? 'text-gray-200' : 'text-gray-700'}`}>
                {p.description}
                {p.note && <div className={`mt-0.5 text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{p.note}</div>}
              </td>
              <td className="px-5 py-3 align-top"><StatusBadge status={p.status} dark={dark} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function CompliancePortal({ data }: { data: ComplianceData }) {
  const [isDark, setIsDark] = useState(false)
  const [activeSection, setActiveSection] = useState('overview')

  useEffect(() => {
    if (localStorage.getItem('compliance-theme') === 'dark') setIsDark(true)
  }, [])

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

  function toggleTheme() {
    const next = !isDark
    setIsDark(next)
    localStorage.setItem('compliance-theme', next ? 'dark' : 'light')
  }

  // Derived
  const pspPending = data.pspConfirmedTotal - data.pspMintedTotal
  const variance = Math.round(data.onChainSupply - (data.pspMintedTotal + data.reconAdjustments))
  const fullyReconciled = Math.abs(variance) < 1
  const dailyCapPct = pct(data.issuedToday, data.platformDailyCap)
  const requiredLiqBuffer = data.avg30dDailyRedemptions != null
    ? Math.round(data.avg30dDailyRedemptions * 30 * 0.20)
    : null

  const d = isDark
  const bg = d ? 'bg-gray-950' : 'bg-gray-50'
  const sidebarBg = d ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
  const textPrimary = d ? 'text-white' : 'text-gray-900'
  const textSecondary = d ? 'text-gray-400' : 'text-gray-500'
  const textMuted = d ? 'text-gray-500' : 'text-gray-400'
  const divider = d ? 'border-gray-800' : 'border-gray-100'

  return (
    <div className={`flex min-h-screen ${bg}`}>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className={`fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r lg:flex ${sidebarBg}`}>
        <div className={`px-6 py-6 border-b ${divider}`}>
          <div className={`font-semibold ${textPrimary}`}>nTZS Compliance</div>
          <div className={`text-xs mt-0.5 ${textMuted}`}>NEDA LABS Limited</div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeSection === s.id
                  ? d ? 'bg-gray-800 text-white font-medium' : 'bg-gray-100 text-gray-900 font-medium'
                  : d ? 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className={`border-t px-3 py-4 space-y-1 ${divider}`}>
          <Link
            href="/app/oversight"
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${d ? 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            Oversight
          </Link>
          <button
            onClick={toggleTheme}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${d ? 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}
          >
            {d ? (
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
              </svg>
            ) : (
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              </svg>
            )}
            {d ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 lg:ml-56">
        {/* Header bar */}
        <div className={`sticky top-0 z-20 border-b px-6 py-4 ${d ? 'bg-gray-950/95 border-gray-800 backdrop-blur' : 'bg-gray-50/95 border-gray-200 backdrop-blur'}`}>
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <div>
              <span className={`font-semibold ${textPrimary}`}>Compliance Portal</span>
              <span className={`ml-3 text-sm hidden sm:inline ${textSecondary}`}>Bank of Tanzania Sandbox · Ref. {data.botApprovalRef}</span>
            </div>
            <div className="flex items-center gap-3">
              <ExportReportButton />
              <button onClick={toggleTheme} className={`lg:hidden p-2 rounded-lg ${d ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-100'}`}>
                {d ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-4xl space-y-12 px-6 py-10">

          {/* ── Overview ─────────────────────────────────────────────────── */}
          <div id="overview" className="grid gap-4 sm:grid-cols-3">
            {/* Countdown */}
            <Card dark={d} className="sm:col-span-1 p-6 flex flex-col justify-between">
              <div className={`text-sm ${textSecondary}`}>Days to commencement</div>
              <div className={`mt-4 text-6xl font-bold tracking-tight ${data.daysToDeadline <= 30 ? 'text-amber-500' : textPrimary}`}>
                {data.daysToDeadline}
              </div>
              <div className={`mt-2 text-xs ${textMuted}`}>Deadline 23 June 2026</div>
            </Card>

            {/* Sandbox details */}
            <Card dark={d} className="sm:col-span-2 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className={`text-sm font-medium ${textPrimary}`}>Bank of Tanzania Fintech Regulatory Sandbox</div>
                  <div className={`mt-1 text-sm ${textSecondary}`}>Approval date: 23 April 2026 · Commencement deadline: 23 June 2026</div>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${data.daysToDeadline > 0 ? (d ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-50 text-amber-700') : (d ? 'bg-green-900/40 text-green-400' : 'bg-green-50 text-green-700')}`}>
                  {data.sandboxPhase}
                </span>
              </div>
              <div className={`mt-4 grid grid-cols-2 gap-4 border-t pt-4 text-sm ${divider}`}>
                <div>
                  <div className={textMuted}>Approval reference</div>
                  <div className={`mt-0.5 font-mono font-medium ${textPrimary}`}>{data.botApprovalRef}</div>
                </div>
                <div>
                  <div className={textMuted}>Applicant</div>
                  <div className={`mt-0.5 font-medium ${textPrimary}`}>NEDA LABS Company Limited</div>
                </div>
              </div>
            </Card>
          </div>

          {/* ── Reserve Integrity ────────────────────────────────────────── */}
          <div>
            <SectionTitle
              id="reserves"
              title="Reserve Integrity"
              sub="Snippe-confirmed fiat receipts versus on-chain token supply. The on-chain totalSupply() is the authoritative circulation figure."
              dark={d}
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                label="On-chain supply"
                value={fmt(data.onChainSupply)}
                sub="Base mainnet totalSupply()"
                dark={d}
              />
              <MetricCard
                label="PSP confirmed (Snippe)"
                value={fmt(data.pspConfirmedTotal)}
                sub="Webhook-confirmed fiat received"
                dark={d}
              />
              <MetricCard
                label="Minted from PSP receipts"
                value={fmt(data.pspMintedTotal)}
                sub="Snippe-confirmed and on-chain"
                dark={d}
              />
              <MetricCard
                label="Pending pipeline"
                value={fmt(pspPending)}
                sub="Confirmed, awaiting mint"
                dark={d}
              />
            </div>

            <Card dark={d} className="mt-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className={`text-sm font-medium ${textPrimary}`}>
                    Variance
                    <span className={`ml-3 font-semibold ${fullyReconciled ? 'text-green-500' : 'text-red-500'}`}>
                      {fullyReconciled ? 'TZS 0 — fully reconciled' : `${variance > 0 ? '+' : ''}${fmt(Math.abs(variance))}`}
                    </span>
                  </div>
                  <div className={`mt-0.5 text-xs ${textMuted}`}>
                    On-chain vs. (PSP minted + reconciliation adjustments of {fmt(data.reconAdjustments)})
                  </div>
                </div>
                <div className={`text-sm ${textSecondary}`}>
                  Reserve ratio: <span className="font-semibold text-green-500">100%</span>
                  <span className={`ml-1 ${textMuted}`}>— enforced by dual-approval workflow</span>
                </div>
              </div>
              {requiredLiqBuffer != null && (
                <div className={`mt-3 border-t pt-3 text-sm ${divider}`}>
                  <span className={textSecondary}>Liquidity buffer required (LR-1):</span>
                  <span className={`ml-2 font-semibold text-amber-500`}>{fmt(requiredLiqBuffer)}</span>
                  <span className={`ml-1 text-xs ${textMuted}`}>20% × 30-day avg redemptions</span>
                </div>
              )}
            </Card>

            <div className="mt-3">
              <a
                href={`https://basescan.org/token/${data.contractAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-xs underline underline-offset-2 ${textMuted} hover:${textSecondary}`}
              >
                Verify supply at Basescan
              </a>
            </div>
          </div>

          {/* ── Issuance Controls ────────────────────────────────────────── */}
          <div>
            <SectionTitle
              id="issuance"
              title="Issuance Controls"
              sub="All limits enforced at the API layer with a full audit trail on every transaction."
              dark={d}
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {/* Platform daily cap — live bar */}
              <Card dark={d} className="p-6">
                <div className="flex items-center justify-between">
                  <div className={`text-sm ${textSecondary}`}>Para #6 — Platform daily cap</div>
                  <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 ${d ? 'bg-green-900/40 text-green-400' : 'bg-green-50 text-green-700'}`}>Enforced</span>
                </div>
                <div className={`mt-3 text-3xl font-bold tracking-tight ${textPrimary}`}>{fmt(data.platformDailyCap)}</div>
                <div className="mt-4">
                  <div className={`mb-1.5 flex justify-between text-xs ${textMuted}`}>
                    <span>Issued today: {fmt(data.issuedToday)}</span>
                    <span>{dailyCapPct}%</span>
                  </div>
                  <div className={`h-1.5 rounded-full overflow-hidden ${d ? 'bg-gray-800' : 'bg-gray-100'}`}>
                    <div
                      className={`h-full rounded-full ${dailyCapPct > 90 ? 'bg-red-500' : dailyCapPct > 70 ? 'bg-amber-500' : 'bg-green-500'}`}
                      style={{ width: `${dailyCapPct}%` }}
                    />
                  </div>
                </div>
              </Card>

              {[
                { ref: 'Para #3', label: 'Per-transaction cap', limit: data.perTxnCap, note: 'Hard-rejected at API — no exceptions' },
                { ref: 'Para #4', label: 'Daily per-user limit', limit: data.dailyUserCap, note: 'Rolling 24-hour window' },
                { ref: 'Para #5', label: 'Monthly per-user cap', limit: data.monthlyUserCap, note: '30-day rolling window' },
              ].map(({ ref, label, limit, note }) => (
                <Card key={ref} dark={d} className="p-6">
                  <div className="flex items-center justify-between">
                    <div className={`text-sm ${textSecondary}`}>{ref} — {label}</div>
                    <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 ${d ? 'bg-green-900/40 text-green-400' : 'bg-green-50 text-green-700'}`}>Enforced</span>
                  </div>
                  <div className={`mt-3 text-3xl font-bold tracking-tight ${textPrimary}`}>{fmt(limit)}</div>
                  <div className={`mt-2 text-xs ${textMuted}`}>{note}</div>
                </Card>
              ))}
            </div>
          </div>

          {/* ── KYC & Users ──────────────────────────────────────────────── */}
          <div>
            <SectionTitle
              id="kyc"
              title="KYC & Users"
              sub="Identity verification status and registered participant summary."
              dark={d}
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="KYC Approved" value={String(data.kycApproved)} dark={d} />
              <MetricCard label="KYC Pending" value={String(data.kycPending)} dark={d} />
              <MetricCard label="KYC Rejected" value={String(data.kycRejected)} dark={d} />
              <MetricCard label="End users" value={String(data.endUserCount)} sub="Sandbox cap: 100" dark={d} />
            </div>
            <Card dark={d} className="mt-4 p-4">
              <p className={`text-sm ${textSecondary}`}>
                <span className={`font-medium ${textPrimary}`}>Para #8 — Pending.</span> Biometric selfie verification (Smile Identity) and PEP/sanctions
                screening are not yet integrated. Current KYC is national ID and document upload with manual review.
              </p>
            </Card>
          </div>

          {/* ── BoT Parameters ───────────────────────────────────────────── */}
          <div>
            <SectionTitle
              id="parameters"
              title="BoT Parameter Compliance"
              sub="Implemented means live in production. Process Item is a documentation or registration task."
              dark={d}
            />
            <div className="mt-6 space-y-8">
              <div>
                <div className={`mb-3 flex items-center gap-2 text-sm font-medium ${textSecondary}`}>
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  Blocking — required before commencement
                </div>
                <ParamTable params={BLOCKING_PARAMS} dark={d} />
              </div>
              <div>
                <div className={`mb-3 flex items-center gap-2 text-sm font-medium ${textSecondary}`}>
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Required during sandbox operation
                </div>
                <ParamTable params={OPERATIONAL_PARAMS} dark={d} />
              </div>
              <div>
                <div className={`mb-3 flex items-center gap-2 text-sm font-medium ${textSecondary}`}>
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  Pre-testing documents to submit to BoT
                </div>
                <ParamTable params={PRE_TESTING_PARAMS} dark={d} />
              </div>
            </div>
          </div>

          {/* ── Governance ───────────────────────────────────────────────── */}
          <div>
            <SectionTitle
              id="governance"
              title="Governance & Smart Contract"
              sub="On-chain contract details, role accountability, and enforcement actions."
              dark={d}
            />
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <Card dark={d} className="p-6">
                <div className={`mb-4 text-sm font-semibold ${textPrimary}`}>Smart Contract</div>
                <dl className={`space-y-4 text-sm ${textSecondary}`}>
                  <div className="flex justify-between gap-2">
                    <dt>Network</dt>
                    <dd className={`font-medium text-right ${textPrimary}`}>Base Mainnet — Chain ID 8453</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Contract type</dt>
                    <dd className={`font-medium text-right ${textPrimary}`}>NTZSV2 UUPS ERC-20</dd>
                  </div>
                  <div className={`border-t pt-4 ${divider}`}>
                    <div className={textMuted}>Proxy address</div>
                    <a
                      href={`https://basescan.org/token/${data.contractAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`mt-1 block break-all font-mono text-xs underline underline-offset-2 ${d ? 'text-blue-400' : 'text-blue-600'}`}
                    >
                      {data.contractAddress}
                    </a>
                  </div>
                  <div>
                    <div className={textMuted}>Gnosis Safe (admin)</div>
                    <a
                      href={`https://basescan.org/address/${data.safeAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`mt-1 block break-all font-mono text-xs underline underline-offset-2 ${d ? 'text-blue-400' : 'text-blue-600'}`}
                    >
                      {data.safeAddress}
                    </a>
                  </div>
                  <div className={`rounded-lg px-3 py-2 text-xs ${d ? 'bg-amber-900/20 text-amber-400' : 'bg-amber-50 text-amber-700'}`}>
                    Third-party audit required before sandbox commencement.
                  </div>
                </dl>
              </Card>

              <div className="space-y-4">
                <Card dark={d} className="p-6">
                  <div className={`mb-4 text-sm font-semibold ${textPrimary}`}>Contract Roles</div>
                  <table className="min-w-full text-xs">
                    <tbody className={`divide-y ${d ? 'divide-gray-800' : 'divide-gray-100'}`}>
                      {[
                        ['MINTER_ROLE', 'Mint nTZS after fiat confirmation'],
                        ['BURNER_ROLE', 'Burn nTZS on redemption'],
                        ['PAUSER_ROLE', 'Emergency pause all transfers'],
                        ['FREEZER_ROLE', 'Freeze individual wallet'],
                        ['BLACKLISTER_ROLE', 'Permanently block address'],
                        ['WIPER_ROLE', 'Burn balance of blacklisted address'],
                      ].map(([role, desc]) => (
                        <tr key={role}>
                          <td className={`py-2 pr-4 font-mono ${textMuted}`}>{role}</td>
                          <td className={`py-2 ${textSecondary}`}>{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>

                {data.recentEnforcement.length > 0 && (
                  <Card dark={d} className="p-6">
                    <div className={`mb-4 text-sm font-semibold ${textPrimary}`}>Recent Enforcement</div>
                    <div className="space-y-3">
                      {data.recentEnforcement.map((e, i) => (
                        <div key={i} className="flex items-start justify-between gap-2 text-xs">
                          <div>
                            <span className={`font-medium ${textPrimary}`}>{e.action.replace(/_/g, ' ')}</span>
                            {e.actorEmail && <span className={`ml-1 ${textMuted}`}>by {e.actorEmail}</span>}
                          </div>
                          {e.createdAt && (
                            <span className={`shrink-0 ${textMuted}`}>
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
          </div>

          {/* ── Activity ─────────────────────────────────────────────────── */}
          <div>
            <SectionTitle
              id="activity"
              title="Activity — Last 24 Hours"
              sub="Platform deposit and redemption summary."
              dark={d}
            />
            <Card dark={d} className="mt-6 overflow-hidden">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className={d ? 'bg-gray-800/50' : 'bg-gray-50'}>
                    <th className={`px-6 py-3 text-left text-xs font-medium ${textMuted}`}>Category</th>
                    <th className={`px-6 py-3 text-right text-xs font-medium ${textMuted}`}>Count</th>
                    <th className={`px-6 py-3 text-right text-xs font-medium ${textMuted}`}>Volume</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${d ? 'divide-gray-800' : 'divide-gray-100'}`}>
                  {[
                    { label: 'Deposits initiated', count: data.deposits24hCount, tzs: data.deposits24hTzs, warn: false },
                    { label: 'Redemptions completed', count: data.burns24hCount, tzs: data.burns24hTzs, warn: false },
                    { label: 'Rejected / failed deposits', count: data.deposits24hRejected, tzs: null, warn: data.deposits24hRejected > 0 },
                  ].map(row => (
                    <tr key={row.label}>
                      <td className={`px-6 py-4 ${textSecondary}`}>{row.label}</td>
                      <td className={`px-6 py-4 text-right font-semibold ${row.warn ? 'text-red-500' : textPrimary}`}>{row.count}</td>
                      <td className={`px-6 py-4 text-right ${row.tzs != null ? textPrimary : textMuted}`}>
                        {row.tzs != null ? fmt(row.tzs) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <p className={`mt-2 text-xs ${textMuted}`}>
              Full tables are in the{' '}
              <Link href="/app/oversight" className="underline underline-offset-2">Oversight Dashboard</Link>.
            </p>
          </div>

          {/* ── Export ───────────────────────────────────────────────────── */}
          <div>
            <SectionTitle
              id="export"
              title="Export & Documents"
              sub="Download the compliance report or access submission documents for BoT."
              dark={d}
            />
            <Card dark={d} className="mt-6 p-6">
              <div className="flex flex-wrap items-start justify-between gap-8">
                <div>
                  <div className={`font-medium ${textPrimary}`}>Reserves & Compliance Report</div>
                  <div className={`mt-1 text-sm ${textSecondary}`}>
                    On-chain supply, reserve verification, KYC, issuance controls, recent activity.
                  </div>
                  <div className="mt-4">
                    <ExportReportButton />
                  </div>
                </div>
                <div>
                  <div className={`mb-3 text-sm font-medium ${textPrimary}`}>Pre-testing documents</div>
                  {[
                    'Testing Environment Agreement — pending',
                    'PSP partnership confirmation — pending',
                    'Risk Management Plan — pending',
                    'nTZS token flow diagram — pending',
                  ].map(doc => (
                    <div key={doc} className={`text-xs py-0.5 ${textMuted}`}>{doc}</div>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          {/* Footer */}
          <div className={`border-t pt-6 text-xs ${divider} ${textMuted}`}>
            <div className="flex flex-wrap justify-between gap-2">
              <span>NEDA LABS Company Limited · Dar es Salaam, Tanzania</span>
              <span>Generated {data.generatedAt} EAT · Refresh for latest data</span>
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
