'use client'

import { useEffect, useRef, useState } from 'react'
import { OversightSidebar } from './OversightSidebar'
import { ExportReportButton } from './ExportReportButton'
import { formatDateTimeEAT } from '@/lib/format-date'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OversightData {
  stats: { totalUsers: number; totalDeposits: number }
  pspBalance: { available: number; pending: number; currency: string; pspName: string }
  kycStats: { total: number; approved: number; pending: number; rejected: number }
  todayIssuance: { issuedTzs: number; capTzs: number } | null
  recentDeposits: Array<{
    id: string; amountTzs: number; status: string
    paymentProvider: string | null; pspReference: string | null
    createdAt: string | null; userEmail: string | null; txHash: string | null
  }>
  recentAuditLogs: Array<{
    id: string; action: string; entityType: string | null; entityId: string | null
    metadata: unknown; createdAt: string | null; actorEmail: string | null
  }>
  statusBreakdown: Array<{ status: string; count: number; total: number }>
  recentBurns: Array<{
    id: string; amountTzs: number; status: string; txHash: string | null
    recipientPhone: string | null; payoutStatus: string | null; payoutReference: string | null
    platformFeeTzs: number | null; feeTxHash: string | null
    createdAt: string | null; userEmail: string | null
  }>
  burnStats: { totalBurned: number; burnCount: number; totalPlatformFees: number }
  onChainSupply: string
  userCount: number
  walletCount: number
  contractAddress: string
}

// ── Section registry ──────────────────────────────────────────────────────────

const SECTION_META: Record<string, { title: string; sub: string }> = {
  overview:    { title: 'Dashboard',              sub: 'Platform health at a glance' },
  reserves:    { title: 'Reserve Proof',          sub: 'Verify 1:1 TZS backing for every nTZS in circulation' },
  issuance:    { title: 'Issuance Controls',      sub: 'Daily mint cap and regulatory transaction limits' },
  kyc:         { title: 'Identity Verification',  sub: 'KYC pipeline and user verification status' },
  deposits:    { title: 'Deposits — Money In',    sub: 'TZS deposits converted to nTZS on Base Mainnet' },
  withdrawals: { title: 'Redemptions — Money Out', sub: 'nTZS burned and TZS returned via mobile money' },
  audit:       { title: 'Audit Trail',            sub: 'Administration actions and system events' },
  contract:    { title: 'Smart Contract',         sub: 'On-chain infrastructure and contract governance' },
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const n = (v: number) => v.toLocaleString()

function statusVariant(s: string, d: boolean) {
  if (s === 'minted' || s === 'burned' || s === 'approved' || s === 'kyc_approved')
    return d ? 'border-emerald-500/40 text-emerald-400' : 'border-emerald-600/40 text-emerald-700'
  if (s.includes('pending') || s.includes('processing') || s.includes('confirmed') || s === 'bank_approved' || s === 'platform_approved' || s === 'fiat_confirmed')
    return d ? 'border-amber-500/40 text-amber-400' : 'border-amber-600/40 text-amber-700'
  if (s === 'rejected' || s.includes('failed'))
    return d ? 'border-red-500/40 text-red-400' : 'border-red-600/40 text-red-700'
  if (s === 'requires_second_approval')
    return d ? 'border-violet-500/40 text-violet-400' : 'border-violet-600/40 text-violet-700'
  return d ? 'border-zinc-600/40 text-zinc-500' : 'border-gray-400/40 text-gray-500'
}

function Badge({ status, d }: { status: string; d: boolean }) {
  return (
    <span className={`border font-mono text-[9px] tracking-wider uppercase px-2 py-0.5 ${statusVariant(status, d)}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function BasescanLink({ hash, type = 'tx', d }: { hash: string; type?: 'tx' | 'address' | 'token'; d: boolean }) {
  return (
    <a
      href={`https://basescan.org/${type}/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`font-mono text-[10px] underline underline-offset-2 ${d ? 'text-blue-400/70 hover:text-blue-400' : 'text-blue-600/70 hover:text-blue-700'}`}
    >
      {hash.slice(0, 10)}...
    </a>
  )
}

interface CardProps { label: string; value: string; sub?: string; valueColor?: string; d: boolean }
function Metric({ label, value, sub, valueColor, d }: CardProps) {
  const t1 = d ? 'text-white' : 'text-gray-900'
  const t3 = d ? 'text-zinc-500' : 'text-gray-400'
  const t4 = d ? 'text-zinc-600' : 'text-gray-400'
  return (
    <div className={`p-5 border ${d ? 'bg-black border-white/8' : 'bg-white border-gray-200'}`}>
      <div className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>{label}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums tracking-tight ${valueColor ?? t1}`}>{value}</div>
      {sub && <div className={`mt-1 text-[10px] ${t4}`}>{sub}</div>}
    </div>
  )
}

interface FlowStepProps { label: string; sub: string; d: boolean; highlight?: string }
function FlowStep({ label, sub, d, highlight }: FlowStepProps) {
  return (
    <div className={`flex-1 min-w-0 p-3 border ${highlight ?? (d ? 'border-white/8' : 'border-gray-200')}`}>
      <div className={`font-mono text-[9px] font-semibold tracking-wider uppercase ${d ? 'text-white' : 'text-gray-800'}`}>{label}</div>
      <div className={`mt-1 font-mono text-[9px] leading-relaxed ${d ? 'text-zinc-500' : 'text-gray-500'}`}>{sub}</div>
    </div>
  )
}
function FlowArrow({ d }: { d: boolean }) {
  return (
    <div className={`flex shrink-0 items-center self-stretch ${d ? 'text-zinc-700' : 'text-gray-300'}`}>
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
      </svg>
    </div>
  )
}

// ── Section: Overview ─────────────────────────────────────────────────────────

function OverviewSection({ data, d, onNavigate }: { data: OversightData; d: boolean; onNavigate: (id: string) => void }) {
  const supply = Math.floor(parseFloat(data.onChainSupply))
  const issuedToday = data.todayIssuance?.issuedTzs ?? 0
  const capToday = data.todayIssuance?.capTzs ?? 100_000_000
  const capPct = Math.min(100, (issuedToday / capToday) * 100)

  const t1 = d ? 'text-white' : 'text-gray-900'
  const t2 = d ? 'text-zinc-400' : 'text-gray-500'
  const t3 = d ? 'text-zinc-600' : 'text-gray-400'
  const border = d ? 'border-white/8' : 'border-gray-200'
  const surface = d ? 'bg-black' : 'bg-white'
  const divider = d ? 'divide-white/5' : 'divide-gray-100'
  const rowHov  = d ? 'hover:bg-white/[0.02]' : 'hover:bg-gray-50'

  return (
    <div className="space-y-5">

      {/* Hero number */}
      <div className={`p-7 border ${border} ${surface}`}>
        <div className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>Total nTZS in circulation</div>
        <div className={`mt-2 text-5xl font-bold tabular-nums tracking-tight ${t1}`}>
          {n(supply)}
          <span className={`ml-3 text-2xl font-normal ${t3}`}>nTZS</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a
            href={`https://basescan.org/token/${data.contractAddress}`}
            target="_blank" rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 font-mono text-[10px] underline underline-offset-2 ${d ? 'text-blue-400/70 hover:text-blue-400' : 'text-blue-600/70 hover:text-blue-700'}`}
          >
            Verify independently on Basescan
            <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
          <span className={`font-mono text-[9px] ${d ? 'text-white/10' : 'text-gray-200'}`}>|</span>
          <span className={`font-mono text-[9px] tracking-widest uppercase ${d ? 'text-emerald-400' : 'text-emerald-600'}`}>
            Fully backed 1:1 by TZS
          </span>
          <span className={`font-mono text-[9px] ${d ? 'text-white/10' : 'text-gray-200'}`}>|</span>
          <span className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>Base Mainnet · Chain ID 8453</span>
        </div>
      </div>

      {/* 4 summary metrics */}
      <div className={`grid gap-px sm:grid-cols-2 lg:grid-cols-4 border ${border} ${d ? 'bg-white/8' : 'bg-gray-200'}`}>
        <Metric label="Deposits processed" value={n(data.stats.totalDeposits)} sub={`${n(data.pspBalance.available)} ${data.pspBalance.currency} settled`} d={d} />
        <Metric label="KYC verified" value={n(data.kycStats.approved)} sub={`${n(data.kycStats.pending)} pending review`} d={d} valueColor={d ? 'text-emerald-400' : 'text-emerald-600'} />
        <Metric
          label="Daily cap used"
          value={`${capPct.toFixed(2)}%`}
          sub={`${n(issuedToday)} of ${n(capToday)} TZS`}
          d={d}
          valueColor={capPct > 90 ? (d ? 'text-red-400' : 'text-red-600') : capPct > 70 ? (d ? 'text-amber-400' : 'text-amber-600') : undefined}
        />
        <Metric label="Registered users" value={n(data.userCount)} sub={`${n(data.walletCount)} wallets connected`} d={d} />
      </div>

      {/* Quick navigation cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { id: 'reserves',    label: 'Reserve Proof',   desc: 'Verify 1:1 TZS backing' },
          { id: 'deposits',    label: 'Money In',        desc: 'TZS deposit flow' },
          { id: 'withdrawals', label: 'Money Out',       desc: 'Redemption flow' },
          { id: 'audit',       label: 'Audit Trail',     desc: 'Admin actions log' },
        ].map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`p-4 border text-left transition-all ${d
              ? 'border-white/8 bg-black hover:bg-white/[0.03] hover:border-white/15'
              : 'border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300'}`}
          >
            <div className={`font-mono text-[10px] font-semibold tracking-wide ${t1}`}>{item.label}</div>
            <div className={`mt-0.5 font-mono text-[9px] ${t2}`}>{item.desc}</div>
          </button>
        ))}
      </div>

      {/* Recent activity */}
      <div className={`border ${border}`}>
        <div className={`border-b px-5 py-3 ${border}`}>
          <span className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>Recent transactions</span>
        </div>
        <div className={`divide-y ${divider}`}>
          {data.recentDeposits.slice(0, 6).map(dep => (
            <div key={dep.id} className={`flex items-center gap-4 px-5 py-3 transition-colors ${rowHov}`}>
              <Badge status={dep.status} d={d} />
              <span className={`font-mono text-sm font-semibold tabular-nums ${t1}`}>{n(dep.amountTzs)} TZS</span>
              <span className={`font-mono text-[10px] ${t2} hidden md:block`}>{dep.userEmail ?? '—'}</span>
              <span className={`ml-auto font-mono text-[9px] ${t3}`}>
                {dep.createdAt ? formatDateTimeEAT(new Date(dep.createdAt)) : '—'}
              </span>
              {dep.txHash && <BasescanLink hash={dep.txHash} d={d} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Section: Reserve Proof ────────────────────────────────────────────────────

function ReservesSection({ data, d }: { data: OversightData; d: boolean }) {
  const supply = Math.floor(parseFloat(data.onChainSupply))
  const t1 = d ? 'text-white' : 'text-gray-900'
  const t2 = d ? 'text-zinc-400' : 'text-gray-500'
  const t3 = d ? 'text-zinc-600' : 'text-gray-400'
  const border = d ? 'border-white/8' : 'border-gray-200'
  const surface = d ? 'bg-black' : 'bg-white'
  const infoSurface = d ? 'bg-white/[0.02]' : 'bg-blue-50/50'
  const divider = d ? 'divide-white/5' : 'divide-gray-100'

  return (
    <div className="space-y-5">

      {/* Explainer */}
      <div className={`p-5 border ${border} ${infoSurface}`}>
        <div className={`font-mono text-[9px] tracking-widest uppercase ${d ? 'text-blue-400/60' : 'text-blue-600/60'}`}>How reserve integrity works</div>
        <p className={`mt-2 text-sm leading-relaxed ${t2}`}>
          Every nTZS token in circulation is backed 1:1 by real TZS. When a customer sends TZS via mobile money,
          Snippe confirms receipt before any tokens are issued. No nTZS can exist without a corresponding TZS deposit.
          The on-chain supply is the authoritative figure — independently verifiable on Base Mainnet at any time.
        </p>
      </div>

      {/* Two key numbers */}
      <div className={`grid gap-px md:grid-cols-2 border ${border} ${d ? 'bg-white/8' : 'bg-gray-200'}`}>
        <div className={`p-7 ${surface}`}>
          <div className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>nTZS in circulation</div>
          <div className={`mt-2 text-4xl font-bold tabular-nums tracking-tight ${t1}`}>{n(supply)}</div>
          <div className={`mt-1 font-mono text-[10px] ${t3}`}>Source: Base Mainnet contract · totalSupply()</div>
          <a
            href={`https://basescan.org/token/${data.contractAddress}`}
            target="_blank" rel="noopener noreferrer"
            className={`mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] underline underline-offset-2 ${d ? 'text-blue-400/70 hover:text-blue-400' : 'text-blue-600/70 hover:text-blue-700'}`}
          >
            Verify on Basescan
            <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
          <div className={`mt-4 flex items-center gap-2 font-mono text-[9px] tracking-widest uppercase ${d ? 'text-emerald-400' : 'text-emerald-600'}`}>
            <div className={`h-1.5 w-1.5 rounded-full ${d ? 'bg-emerald-400' : 'bg-emerald-500'}`} />
            Fully backed
          </div>
        </div>
        <div className={`p-7 ${surface}`}>
          <div className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>PSP settled balance ({data.pspBalance.pspName})</div>
          <div className={`mt-2 text-4xl font-bold tabular-nums tracking-tight ${d ? 'text-emerald-400' : 'text-emerald-600'}`}>{n(data.pspBalance.available)}</div>
          <div className={`mt-1 font-mono text-[10px] ${t3}`}>Live from {data.pspBalance.pspName} · {data.pspBalance.currency} · 1:1 nTZS backing</div>
          <p className={`mt-3 font-mono text-[10px] leading-relaxed ${d ? 'text-zinc-600' : 'text-gray-400'}`}>
            This is the live balance from the active PSP — the source of truth for reserve backing.
            Switching providers updates this automatically.
          </p>
        </div>
      </div>

      {/* Mint flow */}
      <div className={`border ${border}`}>
        <div className={`border-b px-5 py-3 ${border}`}>
          <span className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>How a deposit becomes nTZS</span>
        </div>
        <div className="p-5">
          <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
            <FlowStep label="Customer" sub="Sends TZS via M-Pesa or TigoPesa" d={d} />
            <FlowArrow d={d} />
            <FlowStep label="Snippe confirms" sub="PSP webhook — fiat_confirmed" d={d} highlight={d ? 'border-blue-500/30' : 'border-blue-300'} />
            <FlowArrow d={d} />
            <FlowStep label="Dual approval" sub="Bank review + Platform approval" d={d} highlight={d ? 'border-violet-500/30' : 'border-violet-300'} />
            <FlowArrow d={d} />
            <FlowStep label="nTZS minted" sub="MINTER_ROLE issues tokens on Base" d={d} highlight={d ? 'border-emerald-500/30' : 'border-emerald-300'} />
            <FlowArrow d={d} />
            <FlowStep label="User wallet" sub="Customer receives nTZS balance" d={d} />
          </div>
        </div>
      </div>

      {/* Technical verification */}
      <div className={`border divide-y ${border} ${divider}`}>
        {[
          { label: 'Contract address',  value: data.contractAddress, href: `https://basescan.org/address/${data.contractAddress}` },
          { label: 'Network',           value: 'Base Mainnet · Chain ID 8453', href: null },
          { label: 'Contract standard', value: 'NTZSV2 · UUPS Upgradeable ERC-20', href: null },
          { label: 'Safe multi-sig',    value: '0xB2b8C08a9AEB0E22242e6fC9cD78FC2402cBC503', href: 'https://basescan.org/address/0xB2b8C08a9AEB0E22242e6fC9cD78FC2402cBC503' },
        ].map(row => (
          <div key={row.label} className="flex items-center justify-between gap-4 px-5 py-3">
            <span className={`font-mono text-[10px] ${t3} shrink-0`}>{row.label}</span>
            {row.href ? (
              <a href={row.href} target="_blank" rel="noopener noreferrer"
                className={`font-mono text-xs break-all underline underline-offset-2 ${d ? 'text-blue-400/70 hover:text-blue-400' : 'text-blue-600/70 hover:text-blue-700'}`}>
                {row.value}
              </a>
            ) : (
              <span className={`font-mono text-xs ${t2}`}>{row.value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Section: Issuance Controls ────────────────────────────────────────────────

function IssuanceSection({ data, d }: { data: OversightData; d: boolean }) {
  const issuedToday = data.todayIssuance?.issuedTzs ?? 0
  const capToday = data.todayIssuance?.capTzs ?? 100_000_000
  const capPct = Math.min(100, (issuedToday / capToday) * 100)

  const t1 = d ? 'text-white' : 'text-gray-900'
  const t2 = d ? 'text-zinc-400' : 'text-gray-500'
  const t3 = d ? 'text-zinc-600' : 'text-gray-400'
  const border = d ? 'border-white/8' : 'border-gray-200'
  const surface = d ? 'bg-black' : 'bg-white'
  const divider = d ? 'divide-white/5' : 'divide-gray-100'

  const LIMITS = [
    { param: 'Para #6', label: 'Platform daily cap',       limit: '100,000,000 TZS', note: `${capPct.toFixed(2)}% used today` },
    { param: 'Para #3', label: 'Per-transaction maximum',  limit: '1,000,000 TZS',   note: 'Enforced at API level before deposit' },
    { param: 'Para #4', label: 'Daily per-user limit',     limit: '2,000,000 TZS',   note: 'Rolling 24-hour window per wallet' },
    { param: 'Para #5', label: 'Monthly per-user cap',     limit: '60,000,000 TZS',  note: 'Rolling 30-day window per wallet' },
  ]

  return (
    <div className="space-y-5">

      {/* Today's cap */}
      <div className={`p-7 border ${border} ${surface}`}>
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>Issued today</div>
            <div className={`mt-2 text-4xl font-bold tabular-nums tracking-tight ${t1}`}>
              {n(issuedToday)}
              <span className={`ml-3 text-xl font-normal ${t3}`}>TZS</span>
            </div>
          </div>
          <div className="text-right">
            <div className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>Daily cap</div>
            <div className={`mt-2 text-xl font-bold tabular-nums ${t2}`}>{n(capToday)} TZS</div>
          </div>
        </div>
        <div className="mt-5">
          <div className={`h-2 w-full overflow-hidden ${d ? 'bg-white/5' : 'bg-gray-100'}`}>
            <div
              className={`h-full transition-all ${capPct > 90 ? 'bg-red-500' : capPct > 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
              style={{ width: `${capPct}%` }}
            />
          </div>
          <div className={`mt-2 flex justify-between font-mono text-[9px] tracking-widest uppercase ${t3}`}>
            <span>0%</span>
            <span>{capPct.toFixed(2)}% utilized</span>
            <span>100%</span>
          </div>
        </div>
      </div>

      {/* BoT parameter table */}
      <div className={`border divide-y ${border} ${divider}`}>
        <div className={`border-b px-5 py-3 ${border}`}>
          <span className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>BoT sandbox regulatory limits — all enforced</span>
        </div>
        {LIMITS.map(lim => (
          <div key={lim.param} className="flex items-center justify-between gap-6 px-5 py-4">
            <div className="flex items-center gap-5">
              <span className={`shrink-0 font-mono text-[9px] tracking-widest uppercase ${d ? 'text-blue-400/50' : 'text-blue-600/50'}`}>{lim.param}</span>
              <div>
                <div className={`text-sm font-medium ${t1}`}>{lim.label}</div>
                <div className={`mt-0.5 font-mono text-[10px] ${t3}`}>{lim.note}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className={`font-mono text-sm font-semibold ${t2}`}>{lim.limit}</span>
              <span className={`border font-mono text-[9px] tracking-wider uppercase px-2 py-0.5 ${d ? 'border-emerald-500/40 text-emerald-400' : 'border-emerald-600/40 text-emerald-700'}`}>
                Enforced
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Section: Identity (KYC) ───────────────────────────────────────────────────

function KycSection({ data, d }: { data: OversightData; d: boolean }) {
  const t1 = d ? 'text-white' : 'text-gray-900'
  const t3 = d ? 'text-zinc-600' : 'text-gray-400'
  const border = d ? 'border-white/8' : 'border-gray-200'
  const divider = d ? 'divide-white/5' : 'divide-gray-100'

  return (
    <div className="space-y-5">
      <div className={`grid gap-px md:grid-cols-3 border ${border} ${d ? 'bg-white/8' : 'bg-gray-200'}`}>
        <Metric label="KYC verified" value={n(data.kycStats.approved)} sub="Identity confirmed, can transact" d={d} valueColor={d ? 'text-emerald-400' : 'text-emerald-600'} />
        <Metric label="Pending review" value={n(data.kycStats.pending)} sub="Submitted, awaiting manual check" d={d} valueColor={d ? 'text-amber-400' : 'text-amber-600'} />
        <Metric label="Rejected" value={n(data.kycStats.rejected)} sub="Did not pass verification" d={d} valueColor={d ? 'text-red-400' : 'text-red-600'} />
      </div>

    </div>
  )
}

// ── Section: Deposits (Money In) ──────────────────────────────────────────────

function DepositsSection({ data, d }: { data: OversightData; d: boolean }) {
  const t1 = d ? 'text-white' : 'text-gray-900'
  const t2 = d ? 'text-zinc-400' : 'text-gray-500'
  const t3 = d ? 'text-zinc-600' : 'text-gray-400'
  const t4 = d ? 'text-zinc-700' : 'text-gray-300'
  const border = d ? 'border-white/8' : 'border-gray-200'
  const divider = d ? 'divide-white/5' : 'divide-gray-100'
  const tblHdr = d ? 'bg-white/[0.02]' : 'bg-gray-50'
  const rowHov = d ? 'hover:bg-white/[0.02]' : 'hover:bg-gray-50'
  const { available, pending, currency, pspName } = data.pspBalance

  return (
    <div className="space-y-5">
      <div className={`grid gap-px sm:grid-cols-3 border ${border} ${d ? 'bg-white/8' : 'bg-gray-200'}`}>
        <Metric label="Total deposits" value={n(data.stats.totalDeposits)} sub="All time" d={d} />
        <Metric
          label="Settled balance"
          value={`${n(available)} ${currency}`}
          sub={`Live from ${pspName} · 1:1 nTZS backing`}
          d={d}
          valueColor={d ? 'text-emerald-400' : 'text-emerald-600'}
        />
        <Metric
          label="Pending settlement"
          value={`${n(pending)} ${currency}`}
          sub={`Received by ${pspName} · not yet settled`}
          d={d}
          valueColor={d ? 'text-amber-400' : 'text-amber-600'}
        />
      </div>

      {/* Deposit flow */}
      <div className={`border ${border}`}>
        <div className={`border-b px-5 py-3 ${border}`}>
          <span className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>Money in — deposit lifecycle</span>
        </div>
        <div className="overflow-x-auto p-5">
          <div className="flex items-stretch gap-1.5 min-w-max">
            <FlowStep label="TZS sent" sub="Customer via Snippe (M-Pesa / TigoPesa / card)" d={d} />
            <FlowArrow d={d} />
            <FlowStep label="fiat_confirmed" sub="Snippe webhook confirms receipt" d={d} highlight={d ? 'border-blue-500/30' : 'border-blue-300'} />
            <FlowArrow d={d} />
            <FlowStep label="bank_approved" sub="Bank review clears the deposit" d={d} highlight={d ? 'border-violet-500/30' : 'border-violet-300'} />
            <FlowArrow d={d} />
            <FlowStep label="platform_approved" sub="Second internal approval" d={d} highlight={d ? 'border-violet-500/30' : 'border-violet-300'} />
            <FlowArrow d={d} />
            <FlowStep label="minted" sub="nTZS issued on Base · tx hash logged" d={d} highlight={d ? 'border-emerald-500/30' : 'border-emerald-300'} />
          </div>
        </div>
      </div>

      {/* 30-day status breakdown */}
      <div className={`border divide-y ${border} ${divider}`}>
        <div className={`border-b px-5 py-3 ${border}`}>
          <span className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>Deposit pipeline — last 30 days by status</span>
        </div>
        {data.statusBreakdown.map(s => (
          <div key={s.status} className="flex items-center justify-between px-5 py-3">
            <Badge status={s.status} d={d} />
            <div className="flex items-center gap-6">
              <span className={`font-mono text-sm font-bold tabular-nums ${t1}`}>{n(s.count)}</span>
              <span className={`font-mono text-sm tabular-nums ${t2}`}>{n(s.total)} TZS</span>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className={`border overflow-x-auto ${border}`}>
        <table className="min-w-full text-xs">
          <thead>
            <tr className={tblHdr}>
              {['Reference', 'User', 'Amount (TZS)', 'Provider', 'Status', 'TX Hash', 'Date'].map(h => (
                <th key={h} className={`px-4 py-3 text-left font-mono text-[9px] tracking-widest uppercase ${t3}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className={`divide-y ${divider}`}>
            {data.recentDeposits.map(dep => (
              <tr key={dep.id} className={`transition-colors ${rowHov}`}>
                <td className={`px-4 py-3 font-mono text-[10px] ${t4}`}>{dep.id.slice(0, 8)}</td>
                <td className={`px-4 py-3 font-mono text-[10px] ${t2}`}>{dep.userEmail ?? '—'}</td>
                <td className={`px-4 py-3 font-mono text-sm font-semibold tabular-nums ${t1}`}>{n(dep.amountTzs)}</td>
                <td className="px-4 py-3">
                  <span className={`border font-mono text-[9px] tracking-wider uppercase px-2 py-0.5 ${
                    dep.paymentProvider === 'snippe' || dep.paymentProvider === 'snippe_card'
                      ? d ? 'border-emerald-500/30 text-emerald-400' : 'border-emerald-600/30 text-emerald-700'
                      : dep.paymentProvider === 'zenopay'
                      ? d ? 'border-violet-500/30 text-violet-400' : 'border-violet-600/30 text-violet-700'
                      : d ? 'border-zinc-600/30 text-zinc-500' : 'border-gray-400/30 text-gray-500'
                  }`}>
                    {dep.paymentProvider ?? 'bank'}
                  </span>
                </td>
                <td className="px-4 py-3"><Badge status={dep.status} d={d} /></td>
                <td className="px-4 py-3">
                  {dep.txHash ? <BasescanLink hash={dep.txHash} d={d} /> : <span className={t4}>—</span>}
                </td>
                <td className={`px-4 py-3 font-mono text-[10px] ${t3}`}>
                  {dep.createdAt ? formatDateTimeEAT(new Date(dep.createdAt)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Section: Withdrawals (Money Out) ──────────────────────────────────────────

function WithdrawalsSection({ data, d }: { data: OversightData; d: boolean }) {
  const t1 = d ? 'text-white' : 'text-gray-900'
  const t2 = d ? 'text-zinc-400' : 'text-gray-500'
  const t3 = d ? 'text-zinc-600' : 'text-gray-400'
  const t4 = d ? 'text-zinc-700' : 'text-gray-300'
  const border = d ? 'border-white/8' : 'border-gray-200'
  const divider = d ? 'divide-white/5' : 'divide-gray-100'
  const tblHdr = d ? 'bg-white/[0.02]' : 'bg-gray-50'
  const rowHov = d ? 'hover:bg-white/[0.02]' : 'hover:bg-gray-50'

  return (
    <div className="space-y-5">
      <div className={`grid gap-px sm:grid-cols-3 border ${border} ${d ? 'bg-white/8' : 'bg-gray-200'}`}>
        <Metric label="Total redeemed" value={`${n(data.burnStats.totalBurned)} TZS`} sub="nTZS burned and paid out" d={d} valueColor={d ? 'text-emerald-400' : 'text-emerald-600'} />
        <Metric label="Redemptions" value={n(data.burnStats.burnCount)} sub="Completed redemptions" d={d} />
        <Metric label="Platform fees collected" value={`${n(data.burnStats.totalPlatformFees)} TZS`} sub="Across all burns" d={d} valueColor={d ? 'text-violet-400' : 'text-violet-600'} />
      </div>

      {/* Redemption flow */}
      <div className={`border ${border}`}>
        <div className={`border-b px-5 py-3 ${border}`}>
          <span className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>Money out — redemption lifecycle</span>
        </div>
        <div className="overflow-x-auto p-5">
          <div className="flex items-stretch gap-1.5 min-w-max">
            <FlowStep label="Request submitted" sub="Customer requests TZS payout + phone number" d={d} />
            <FlowArrow d={d} />
            <FlowStep label="Dual approval" sub="requires_second_approval → platform reviews" d={d} highlight={d ? 'border-violet-500/30' : 'border-violet-300'} />
            <FlowArrow d={d} />
            <FlowStep label="nTZS burned" sub="BURNER_ROLE destroys tokens on Base" d={d} highlight={d ? 'border-red-500/30' : 'border-red-300'} />
            <FlowArrow d={d} />
            <FlowStep label="TZS paid out" sub="Snippe sends TZS to customer's phone" d={d} highlight={d ? 'border-emerald-500/30' : 'border-emerald-300'} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className={`border overflow-x-auto ${border}`}>
        <table className="min-w-full text-xs">
          <thead>
            <tr className={tblHdr}>
              {['Reference', 'User', 'Amount (TZS)', 'Fee', 'Recipient', 'Status', 'Payout', 'Date'].map(h => (
                <th key={h} className={`px-4 py-3 text-left font-mono text-[9px] tracking-widest uppercase ${t3}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className={`divide-y ${divider}`}>
            {data.recentBurns.length === 0 ? (
              <tr><td colSpan={8} className={`px-4 py-10 text-center font-mono text-xs ${t3}`}>No redemptions yet</td></tr>
            ) : data.recentBurns.map(burn => (
              <tr key={burn.id} className={`transition-colors ${rowHov}`}>
                <td className={`px-4 py-3 font-mono text-[10px] ${t4}`}>{burn.id.slice(0, 8)}</td>
                <td className={`px-4 py-3 font-mono text-[10px] ${t2}`}>{burn.userEmail ?? '—'}</td>
                <td className={`px-4 py-3 font-mono text-sm font-semibold tabular-nums ${t1}`}>{n(burn.amountTzs)}</td>
                <td className={`px-4 py-3 font-mono text-xs ${d ? 'text-violet-400' : 'text-violet-600'}`}>
                  {burn.platformFeeTzs ? `+${n(burn.platformFeeTzs)}` : '—'}
                </td>
                <td className={`px-4 py-3 font-mono text-[10px] ${t3}`}>{burn.recipientPhone ?? '—'}</td>
                <td className="px-4 py-3"><Badge status={burn.status} d={d} /></td>
                <td className="px-4 py-3">
                  {burn.payoutStatus ? <Badge status={burn.payoutStatus} d={d} /> : <span className={t4}>—</span>}
                </td>
                <td className={`px-4 py-3 font-mono text-[10px] ${t3}`}>
                  {burn.createdAt ? formatDateTimeEAT(new Date(burn.createdAt)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Section: Audit Trail ──────────────────────────────────────────────────────

function AuditSection({ data, d }: { data: OversightData; d: boolean }) {
  const t1 = d ? 'text-white' : 'text-gray-900'
  const t3 = d ? 'text-zinc-600' : 'text-gray-400'
  const t4 = d ? 'text-zinc-700' : 'text-gray-300'
  const border = d ? 'border-white/8' : 'border-gray-200'
  const divider = d ? 'divide-white/5' : 'divide-gray-100'
  const rowHov = d ? 'hover:bg-white/[0.02]' : 'hover:bg-gray-50'

  return (
    <div className={`border divide-y ${border} ${divider}`}>
      {data.recentAuditLogs.length === 0 ? (
        <div className={`px-5 py-12 text-center font-mono text-xs ${t3}`}>No audit events recorded</div>
      ) : data.recentAuditLogs.map(log => (
        <div key={log.id} className={`flex items-start gap-5 px-5 py-4 transition-colors ${rowHov}`}>
          <div className={`w-28 shrink-0 pt-0.5 font-mono text-[9px] tracking-wider uppercase ${t3}`}>
            {log.createdAt ? formatDateTimeEAT(new Date(log.createdAt)) : '—'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-mono text-xs font-semibold tracking-wider uppercase ${t1}`}>
                {log.action.replace(/_/g, ' ')}
              </span>
              {log.entityType && (
                <span className={`border font-mono text-[9px] tracking-wider uppercase px-2 py-0.5 ${d ? 'border-white/10 text-zinc-500' : 'border-gray-300 text-gray-400'}`}>
                  {log.entityType}
                </span>
              )}
              {log.actorEmail && (
                <span className={`font-mono text-[10px] ${t3}`}>by {log.actorEmail}</span>
              )}
            </div>
            {log.entityId && (
              <div className={`mt-0.5 font-mono text-[10px] ${t4}`}>{log.entityId.slice(0, 20)}...</div>
            )}
            {log.metadata != null && (
              <pre className={`mt-2 max-h-16 overflow-auto border p-2 font-mono text-[9px] ${d ? 'border-white/5 bg-white/[0.02] text-zinc-600' : 'border-gray-200 bg-gray-50 text-gray-400'}`}>
                {JSON.stringify(log.metadata as Record<string, unknown>, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Section: Smart Contract ───────────────────────────────────────────────────

function ContractSection({ data, d }: { data: OversightData; d: boolean }) {
  const t1 = d ? 'text-white' : 'text-gray-900'
  const t2 = d ? 'text-zinc-400' : 'text-gray-500'
  const t3 = d ? 'text-zinc-600' : 'text-gray-400'
  const border = d ? 'border-white/8' : 'border-gray-200'
  const surface = d ? 'bg-black' : 'bg-white'
  const divider = d ? 'divide-white/5' : 'divide-gray-100'

  const ROLES = [
    { role: 'MINTER_ROLE',      desc: 'Issues new nTZS tokens when a deposit is confirmed',       holder: 'Platform hot wallet' },
    { role: 'BURNER_ROLE',      desc: 'Destroys nTZS tokens when a redemption is approved',       holder: 'Platform hot wallet' },
    { role: 'PAUSER_ROLE',      desc: 'Pauses all token transfers in an emergency',               holder: 'Safe multi-sig' },
    { role: 'FREEZER_ROLE',     desc: 'Freezes individual wallets from transacting',              holder: 'Platform admin' },
    { role: 'BLACKLISTER_ROLE', desc: 'Permanently blacklists a wallet for AML compliance',      holder: 'Platform admin' },
    { role: 'WIPER_ROLE',       desc: 'Wipes token balance from a blacklisted wallet',           holder: 'Safe multi-sig' },
  ]

  return (
    <div className="space-y-5">
      <div className={`grid gap-px md:grid-cols-2 border ${border} ${d ? 'bg-white/8' : 'bg-gray-200'}`}>
        <div className={`p-6 ${surface}`}>
          <div className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>Proxy contract address</div>
          <a href={`https://basescan.org/address/${data.contractAddress}`} target="_blank" rel="noopener noreferrer"
            className={`mt-2 block break-all font-mono text-xs underline underline-offset-2 ${d ? 'text-blue-400/70 hover:text-blue-400' : 'text-blue-600/70 hover:text-blue-700'}`}>
            {data.contractAddress || 'Not configured'}
          </a>
          <div className={`mt-2 font-mono text-[10px] ${t3}`}>Base Mainnet · Chain ID 8453 · NTZSV2 UUPS ERC-20</div>
        </div>
        <div className={`p-6 ${surface}`}>
          <div className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>Safe multi-sig (governance)</div>
          <a href="https://basescan.org/address/0xB2b8C08a9AEB0E22242e6fC9cD78FC2402cBC503" target="_blank" rel="noopener noreferrer"
            className={`mt-2 block break-all font-mono text-xs underline underline-offset-2 ${d ? 'text-blue-400/70 hover:text-blue-400' : 'text-blue-600/70 hover:text-blue-700'}`}>
            0xB2b8C08a9AEB0E22242e6fC9cD78FC2402cBC503
          </a>
          <div className={`mt-2 font-mono text-[10px] ${t3}`}>Gnosis Safe · Multi-signature required for admin changes</div>
        </div>
      </div>

      <div className={`border divide-y ${border} ${divider}`}>
        <div className={`border-b px-5 py-3 ${border}`}>
          <span className={`font-mono text-[9px] tracking-widest uppercase ${t3}`}>Contract roles and what they control</span>
        </div>
        {ROLES.map(r => (
          <div key={r.role} className="flex items-start gap-6 px-5 py-4">
            <code className={`shrink-0 font-mono text-[10px] ${d ? 'text-blue-400/70' : 'text-blue-600/70'}`}>{r.role}</code>
            <div className="flex-1">
              <div className={`text-sm ${t1}`}>{r.desc}</div>
              <div className={`mt-0.5 font-mono text-[10px] ${t3}`}>Held by: {r.holder}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function OversightPortal({ data }: { data: OversightData }) {
  const [isDark, setIsDark] = useState(true)
  const [activeSection, setActiveSection] = useState('overview')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('oversight-theme')
    if (saved === 'light') setIsDark(false)
  }, [])

  function toggleTheme() {
    const next = !isDark
    setIsDark(next)
    localStorage.setItem('oversight-theme', next ? 'dark' : 'light')
  }

  function navigate(id: string) {
    setActiveSection(id)
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }

  const d = isDark
  const root    = d ? 'bg-black text-white'   : 'bg-gray-50 text-gray-900'
  const hdrBg   = d ? 'bg-black'              : 'bg-white'
  const hdrBdr  = d ? 'border-white/8'        : 'border-gray-200'
  const t1      = d ? 'text-white'            : 'text-gray-900'
  const t3      = d ? 'text-zinc-600'         : 'text-gray-400'

  const meta = SECTION_META[activeSection] ?? SECTION_META.overview

  const renderSection = () => {
    switch (activeSection) {
      case 'overview':    return <OverviewSection    data={data} d={d} onNavigate={navigate} />
      case 'reserves':    return <ReservesSection    data={data} d={d} />
      case 'issuance':    return <IssuanceSection    data={data} d={d} />
      case 'kyc':         return <KycSection         data={data} d={d} />
      case 'deposits':    return <DepositsSection    data={data} d={d} />
      case 'withdrawals': return <WithdrawalsSection data={data} d={d} />
      case 'audit':       return <AuditSection       data={data} d={d} />
      case 'contract':    return <ContractSection    data={data} d={d} />
      default:            return <OverviewSection    data={data} d={d} onNavigate={navigate} />
    }
  }

  return (
    <div className={`flex h-screen overflow-hidden font-mono ${root}`}>

      {/* Sidebar */}
      <OversightSidebar
        isDark={d}
        onToggle={toggleTheme}
        activeSection={activeSection}
        onNavigate={navigate}
      />

      {/* Content pane */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Header — same vertical rhythm as sidebar header */}
        <div className={`shrink-0 flex items-center justify-between gap-4 px-8 py-6 border-b ${hdrBg} ${hdrBdr}`}>
          <div>
            <h1 className={`text-sm font-bold tracking-wide ${t1}`}>{meta.title}</h1>
            <p className={`mt-1 font-mono text-[9px] tracking-widest uppercase ${t3}`}>{meta.sub}</p>
          </div>
          <ExportReportButton />
        </div>

        {/* Scrollable section content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-6">
          {renderSection()}
          {/* Footer */}
          <div className={`mt-10 flex items-center gap-4 border-t pt-6 font-mono text-[9px] tracking-widest uppercase ${d ? 'border-white/5 text-zinc-700' : 'border-gray-200 text-gray-300'}`}>
            <span>nTZS Network</span>
            <div className={`w-px h-2.5 ${d ? 'bg-white/8' : 'bg-gray-200'}`} />
            <span>NEDA LABS Company Limited</span>
            <div className={`w-px h-2.5 ${d ? 'bg-white/8' : 'bg-gray-200'}`} />
            <span>Dar es Salaam, Tanzania</span>
          </div>
        </div>
      </div>
    </div>
  )
}
