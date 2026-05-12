'use client'

import { useEffect, useState } from 'react'
import { OversightSidebar } from './OversightSidebar'
import { ExportReportButton } from './ExportReportButton'
import { formatDateTimeEAT } from '@/lib/format-date'

// ── Data type ─────────────────────────────────────────────────────────────────

export interface OversightData {
  stats: { totalUsers: number; totalDeposits: number; totalMinted: number; totalPending: number }
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

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ index, label, d }: { index: string; label: string; d: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className={`w-5 h-px ${d ? 'bg-blue-400/50' : 'bg-blue-500/50'}`} />
      <span className={`font-mono text-[9px] tracking-widest uppercase ${d ? 'text-blue-400/60' : 'text-blue-600/70'}`}>
        {index} / {label}
      </span>
      <div className={`flex-1 h-px ${d ? 'bg-white/5' : 'bg-gray-200'}`} />
    </div>
  )
}

function MetricCard({ label, value, sub, d }: { label: string; value: string; sub?: string; d: boolean }) {
  return (
    <div className={`p-5 ${d ? 'bg-[#101010] border-white/8' : 'bg-white border-gray-200'} border`}>
      <div className={`font-mono text-[9px] tracking-widest uppercase ${d ? 'text-zinc-500' : 'text-gray-400'}`}>{label}</div>
      <div className={`mt-3 font-mono text-2xl font-bold tabular-nums ${d ? 'text-white' : 'text-gray-900'}`}>{value}</div>
      {sub && <div className={`mt-1.5 font-mono text-xs ${d ? 'text-zinc-600' : 'text-gray-400'}`}>{sub}</div>}
    </div>
  )
}

function StatusBadge({ status, d }: { status: string; d: boolean }) {
  const color = (s: string) => {
    if (s === 'minted' || s === 'burned' || s === 'kyc_approved')
      return d ? 'border-emerald-500/40 text-emerald-400' : 'border-emerald-600/40 text-emerald-700'
    if (s.includes('pending') || s.includes('processing') || s.includes('approved') || s.includes('confirmed'))
      return d ? 'border-amber-500/40 text-amber-400' : 'border-amber-600/40 text-amber-700'
    if (s === 'rejected' || s.includes('failed'))
      return d ? 'border-red-500/40 text-red-400' : 'border-red-600/40 text-red-700'
    if (s === 'requires_second_approval')
      return d ? 'border-violet-500/40 text-violet-400' : 'border-violet-600/40 text-violet-700'
    return d ? 'border-zinc-600/40 text-zinc-500' : 'border-gray-400/40 text-gray-500'
  }
  return (
    <span className={`border font-mono text-[9px] tracking-wider uppercase px-2 py-0.5 ${color(status)}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function TxLink({ hash, d }: { hash: string; d: boolean }) {
  return (
    <a
      href={`https://basescan.org/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`font-mono text-[10px] underline underline-offset-2 ${d ? 'text-blue-400/70 hover:text-blue-400' : 'text-blue-600/70 hover:text-blue-700'}`}
    >
      {hash.slice(0, 10)}...
    </a>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function OversightPortal({ data }: { data: OversightData }) {
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('oversight-theme')
    if (saved === 'light') setIsDark(false)
  }, [])

  function toggleTheme() {
    const next = !isDark
    setIsDark(next)
    localStorage.setItem('oversight-theme', next ? 'dark' : 'light')
  }

  const d = isDark
  const n = (v: number) => v.toLocaleString()
  const issuedToday = data.todayIssuance?.issuedTzs ?? 0
  const capToday = data.todayIssuance?.capTzs ?? 100_000_000
  const capPct = Math.min(100, (issuedToday / capToday) * 100)

  // Theme tokens
  const root      = d ? 'bg-black text-white'          : 'bg-gray-50 text-gray-900'
  const hdr       = d ? 'border-white/8'                : 'border-gray-200'
  const surface   = d ? 'bg-[#101010] border-white/8'   : 'bg-white border-gray-200'
  const divider   = d ? 'divide-white/5'                : 'divide-gray-100'
  const tblHdr    = d ? 'bg-white/[0.02]'               : 'bg-gray-50'
  const tblHdrTxt = d ? 'text-zinc-600'                 : 'text-gray-400'
  const tblRow    = d ? 'hover:bg-white/[0.02]'         : 'hover:bg-gray-50'
  const txt1      = d ? 'text-white'                    : 'text-gray-900'
  const txt2      = d ? 'text-zinc-400'                 : 'text-gray-500'
  const txt3      = d ? 'text-zinc-600'                 : 'text-gray-400'
  const txt4      = d ? 'text-zinc-700'                 : 'text-gray-300'
  const mono2     = d ? 'text-zinc-300'                 : 'text-gray-700'
  const footerDiv = d ? 'border-white/5'                : 'border-gray-200'

  return (
    <div className={`flex min-h-screen font-mono ${root}`}>
      <OversightSidebar isDark={isDark} onToggle={toggleTheme} />

      <div className="flex-1 lg:ml-60">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className={`border-b px-6 py-5 lg:px-10 ${hdr}`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="w-1 h-4 bg-blue-400" />
                <h1 className={`text-sm font-bold tracking-widest uppercase ${txt1}`}>Oversight Dashboard</h1>
              </div>
              <div className={`mt-1.5 flex items-center gap-3 text-[9px] tracking-widest uppercase ${txt3}`}>
                <span>nTZS Stablecoin Platform</span>
                <div className={`w-px h-2.5 ${d ? 'bg-white/10' : 'bg-gray-300'}`} />
                <span>Real-time Operations</span>
                <div className={`w-px h-2.5 ${d ? 'bg-white/10' : 'bg-gray-300'}`} />
                <div className="flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" />
                  <span className={d ? 'text-blue-400/60' : 'text-blue-600/60'}>Live</span>
                </div>
              </div>
            </div>
            <ExportReportButton />
          </div>
        </div>

        <div className="space-y-10 px-6 py-8 lg:px-10">

          {/* ── 01 / Key Metrics ──────────────────────────────────────── */}
          <section id="overview">
            <SectionLabel index="01" label="Key Metrics" d={d} />
            <div className={`grid gap-px sm:grid-cols-2 lg:grid-cols-4 ${d ? 'bg-white/8' : 'bg-gray-200'} border ${d ? 'border-white/8' : 'border-gray-200'}`}>
              <MetricCard label="On-chain supply"      value={`${n(Math.floor(parseFloat(data.onChainSupply)))} nTZS`} sub="Base mainnet totalSupply()" d={d} />
              <MetricCard label="Total minted (DB)"    value={`${n(data.stats.totalMinted)} TZS`}   sub={`${n(data.stats.totalDeposits)} deposits`} d={d} />
              <MetricCard label="Pending issuance"     value={`${n(data.stats.totalPending)} TZS`}  sub="Awaiting confirmation" d={d} />
              <MetricCard label="Registered users"     value={n(data.userCount)}                   sub={`${n(data.walletCount)} wallets linked`} d={d} />
            </div>
          </section>

          {/* ── 02 / Reserve Verification ─────────────────────────────── */}
          <section id="reserves">
            <SectionLabel index="02" label="Reserve Verification" d={d} />
            <div className={`grid gap-px md:grid-cols-3 ${d ? 'bg-white/8' : 'bg-gray-200'} border ${d ? 'border-white/8' : 'border-gray-200'}`}>
              <MetricCard label="On-chain supply"       value={n(Math.floor(parseFloat(data.onChainSupply)))} sub="nTZS — Base mainnet" d={d} />
              <MetricCard label="Confirmed deposits (DB)" value={n(data.stats.totalMinted)}                 sub="TZS received and minted" d={d} />
              <MetricCard label="Reserve status"        value="1:1 Backed"                                  sub="Dual-approval enforced" d={d} />
            </div>
            <div className={`mt-3 border px-4 py-3 ${d ? 'border-white/5' : 'border-gray-200 bg-white'}`}>
              <div className={`flex items-center gap-2 text-[9px] tracking-widest uppercase ${txt3}`}>
                <span>Contract</span>
                <div className={`w-px h-2.5 ${d ? 'bg-white/8' : 'bg-gray-200'}`} />
                <a
                  href={`https://basescan.org/token/${data.contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`font-mono underline underline-offset-2 ${d ? 'text-blue-400/60 hover:text-blue-400' : 'text-blue-600/60 hover:text-blue-700'}`}
                >
                  {data.contractAddress || 'Not configured'}
                </a>
                <div className={`w-px h-2.5 ${d ? 'bg-white/8' : 'bg-gray-200'}`} />
                <span>Base Mainnet · Chain ID 8453</span>
              </div>
            </div>
          </section>

          {/* ── 03 / Daily Issuance ───────────────────────────────────── */}
          <section id="issuance">
            <SectionLabel index="03" label="Daily Issuance Control" d={d} />
            <div className={`border p-6 ${surface}`}>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className={`text-[9px] tracking-widest uppercase ${txt3}`}>Issued today</div>
                  <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${txt1}`}>{n(issuedToday)} TZS</div>
                </div>
                <div className="text-right">
                  <div className={`text-[9px] tracking-widest uppercase ${txt3}`}>Daily cap</div>
                  <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${txt2}`}>{n(capToday)} TZS</div>
                </div>
              </div>
              <div className="mt-5">
                <div className={`h-1.5 w-full overflow-hidden ${d ? 'bg-white/5' : 'bg-gray-100'}`}>
                  <div
                    className={`h-full transition-all ${capPct > 90 ? 'bg-red-500' : capPct > 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
                    style={{ width: `${capPct}%` }}
                  />
                </div>
                <div className={`mt-2 flex justify-between text-[9px] tracking-widest uppercase ${txt3}`}>
                  <span>0%</span>
                  <span>{capPct.toFixed(2)}% utilized</span>
                  <span>100%</span>
                </div>
              </div>
            </div>
          </section>

          {/* ── 04 / KYC & Pipeline ───────────────────────────────────── */}
          <section id="kyc">
            <SectionLabel index="04" label="KYC & Deposit Pipeline" d={d} />
            <div className="grid gap-6 lg:grid-cols-2">
              <div className={`border ${surface}`}>
                <div className={`border-b px-5 py-3 ${d ? 'border-white/8' : 'border-gray-200'}`}>
                  <div className={`text-[9px] tracking-widest uppercase ${txt3}`}>Identity Verification</div>
                </div>
                <div className={`divide-y ${divider}`}>
                  {[
                    { label: 'Approved',       value: data.kycStats.approved, color: d ? 'text-emerald-400' : 'text-emerald-600' },
                    { label: 'Pending Review', value: data.kycStats.pending,  color: d ? 'text-amber-400'   : 'text-amber-600'   },
                    { label: 'Rejected',       value: data.kycStats.rejected, color: d ? 'text-red-400'     : 'text-red-600'     },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between px-5 py-4">
                      <span className={`font-mono text-xs tracking-wider uppercase ${txt2}`}>{row.label}</span>
                      <span className={`font-mono text-lg font-bold tabular-nums ${row.color}`}>{n(row.value)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={`border ${surface}`}>
                <div className={`border-b px-5 py-3 ${d ? 'border-white/8' : 'border-gray-200'}`}>
                  <div className={`text-[9px] tracking-widest uppercase ${txt3}`}>Deposit Status Distribution</div>
                </div>
                <div className={`divide-y ${divider}`}>
                  {data.statusBreakdown.map(s => (
                    <div key={s.status} className="flex items-center justify-between px-5 py-3">
                      <StatusBadge status={s.status} d={d} />
                      <div className="text-right">
                        <span className={`font-mono text-sm font-bold ${txt1}`}>{n(s.count)}</span>
                        <span className={`ml-2 font-mono text-xs ${txt3}`}>{n(s.total)} TZS</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── 05 / Deposits ─────────────────────────────────────────── */}
          <section id="deposits">
            <SectionLabel index="05" label="Recent Deposits" d={d} />
            <div className={`border overflow-x-auto ${d ? 'border-white/8' : 'border-gray-200'}`}>
              <table className="min-w-full text-xs">
                <thead>
                  <tr className={tblHdr}>
                    {['ID', 'User', 'Amount', 'Provider', 'Reference', 'Status', 'TX Hash', 'Created'].map(h => (
                      <th key={h} className={`px-4 py-3 text-left font-mono text-[9px] tracking-widest uppercase ${tblHdrTxt}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className={`divide-y ${divider}`}>
                  {data.recentDeposits.map(dep => (
                    <tr key={dep.id} className={`transition-colors ${tblRow}`}>
                      <td className={`px-4 py-3 font-mono text-[10px] ${txt4}`}>{dep.id.slice(0, 8)}</td>
                      <td className={`px-4 py-3 font-mono text-[10px] ${mono2}`}>{dep.userEmail ?? '—'}</td>
                      <td className={`px-4 py-3 font-mono text-sm font-semibold tabular-nums ${txt1}`}>{n(dep.amountTzs)}</td>
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
                      <td className={`px-4 py-3 font-mono text-[10px] ${txt3}`}>{dep.pspReference ?? '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={dep.status} d={d} /></td>
                      <td className="px-4 py-3">
                        {dep.txHash ? <TxLink hash={dep.txHash} d={d} /> : <span className={txt4}>—</span>}
                      </td>
                      <td className={`px-4 py-3 font-mono text-[10px] ${txt3}`}>
                        {dep.createdAt ? formatDateTimeEAT(new Date(dep.createdAt)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 06 / Withdrawals ──────────────────────────────────────── */}
          <section id="withdrawals">
            <SectionLabel index="06" label="Withdrawals" d={d} />
            <div className={`mb-3 flex items-center gap-4 font-mono text-[9px] tracking-widest uppercase ${txt3}`}>
              <span>Total burned: <span className={d ? 'text-emerald-400' : 'text-emerald-600'}>{n(data.burnStats.totalBurned)} TZS</span></span>
              <div className={`w-px h-2.5 ${d ? 'bg-white/8' : 'bg-gray-300'}`} />
              <span>Platform fees: <span className={d ? 'text-violet-400' : 'text-violet-600'}>{n(data.burnStats.totalPlatformFees)} TZS</span></span>
              <div className={`w-px h-2.5 ${d ? 'bg-white/8' : 'bg-gray-300'}`} />
              <span>Burns: <span className={txt1}>{n(data.burnStats.burnCount)}</span></span>
            </div>
            <div className={`border overflow-x-auto ${d ? 'border-white/8' : 'border-gray-200'}`}>
              <table className="min-w-full text-xs">
                <thead>
                  <tr className={tblHdr}>
                    {['ID', 'User', 'Burned', 'Fee', 'Recipient', 'Status', 'Payout', 'Burn TX', 'Fee TX', 'Created'].map(h => (
                      <th key={h} className={`px-4 py-3 text-left font-mono text-[9px] tracking-widest uppercase ${tblHdrTxt}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className={`divide-y ${divider}`}>
                  {data.recentBurns.length === 0 ? (
                    <tr><td colSpan={10} className={`px-4 py-10 text-center font-mono text-xs ${txt3}`}>No withdrawals yet</td></tr>
                  ) : data.recentBurns.map(burn => (
                    <tr key={burn.id} className={`transition-colors ${tblRow}`}>
                      <td className={`px-4 py-3 font-mono text-[10px] ${txt4}`}>{burn.id.slice(0, 8)}</td>
                      <td className={`px-4 py-3 font-mono text-[10px] ${mono2}`}>{burn.userEmail ?? '—'}</td>
                      <td className={`px-4 py-3 font-mono text-sm font-semibold tabular-nums ${txt1}`}>{n(burn.amountTzs)}</td>
                      <td className={`px-4 py-3 font-mono text-xs ${d ? 'text-violet-400' : 'text-violet-600'}`}>
                        {burn.platformFeeTzs ? `+${n(burn.platformFeeTzs)}` : '—'}
                      </td>
                      <td className={`px-4 py-3 font-mono text-[10px] ${txt3}`}>{burn.recipientPhone ?? '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={burn.status} d={d} /></td>
                      <td className="px-4 py-3">
                        {burn.payoutStatus ? (
                          <div>
                            <StatusBadge status={burn.payoutStatus} d={d} />
                            {burn.payoutReference && (
                              <div className={`mt-0.5 font-mono text-[9px] ${txt4}`}>#{burn.payoutReference.slice(0, 8)}</div>
                            )}
                          </div>
                        ) : <span className={txt4}>—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {burn.txHash ? <TxLink hash={burn.txHash} d={d} /> : <span className={txt4}>—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {burn.feeTxHash ? <TxLink hash={burn.feeTxHash} d={d} /> : <span className={txt4}>—</span>}
                      </td>
                      <td className={`px-4 py-3 font-mono text-[10px] ${txt3}`}>
                        {burn.createdAt ? formatDateTimeEAT(new Date(burn.createdAt)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 07 / Audit Trail ──────────────────────────────────────── */}
          <section id="audit">
            <SectionLabel index="07" label="Audit Trail" d={d} />
            <div className={`border divide-y ${d ? 'border-white/8 divide-white/5' : 'border-gray-200 divide-gray-100'}`}>
              {data.recentAuditLogs.length === 0 ? (
                <div className={`px-5 py-10 text-center font-mono text-xs ${txt3}`}>No audit logs yet</div>
              ) : data.recentAuditLogs.map(log => (
                <div key={log.id} className={`flex items-start gap-5 px-5 py-4 transition-colors ${tblRow}`}>
                  <div className={`w-24 shrink-0 font-mono text-[9px] tracking-wider uppercase pt-0.5 ${txt3}`}>
                    {log.createdAt ? formatDateTimeEAT(new Date(log.createdAt)) : '—'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-mono text-xs font-semibold tracking-wider uppercase ${txt1}`}>
                        {log.action.replace(/_/g, ' ')}
                      </span>
                      {log.entityType && (
                        <span className={`border font-mono text-[9px] tracking-wider uppercase px-2 py-0.5 ${d ? 'border-white/10 text-zinc-500' : 'border-gray-300 text-gray-400'}`}>
                          {log.entityType}
                        </span>
                      )}
                      {log.actorEmail && (
                        <span className={`font-mono text-[10px] ${txt3}`}>by {log.actorEmail}</span>
                      )}
                    </div>
                    {log.entityId && (
                      <div className={`mt-1 font-mono text-[10px] ${txt4}`}>entity: {log.entityId.slice(0, 16)}...</div>
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
          </section>

          {/* ── 08 / Contract ─────────────────────────────────────────── */}
          <section id="contract">
            <SectionLabel index="08" label="Smart Contract" d={d} />
            <div className={`grid gap-px md:grid-cols-2 ${d ? 'bg-white/8' : 'bg-gray-200'} border ${d ? 'border-white/8' : 'border-gray-200'}`}>
              <div className={d ? 'bg-black p-5' : 'bg-white p-5'}>
                <div className={`font-mono text-[9px] tracking-widest uppercase ${txt3}`}>Proxy Address</div>
                <a
                  href={`https://basescan.org/address/${data.contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`mt-2 block break-all font-mono text-xs underline underline-offset-2 ${d ? 'text-blue-400/70 hover:text-blue-400' : 'text-blue-600/70 hover:text-blue-700'}`}
                >
                  {data.contractAddress || 'Not configured'}
                </a>
                <div className={`mt-1.5 font-mono text-[9px] ${txt4}`}>Base Mainnet · Chain ID 8453 · NTZSV2 UUPS ERC-20</div>
              </div>
              <div className={d ? 'bg-black p-5' : 'bg-white p-5'}>
                <div className={`font-mono text-[9px] tracking-widest uppercase ${txt3}`}>Block Explorer</div>
                <a
                  href={`https://basescan.org/token/${data.contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`mt-2 block font-mono text-xs underline underline-offset-2 ${d ? 'text-blue-400/70 hover:text-blue-400' : 'text-blue-600/70 hover:text-blue-700'}`}
                >
                  View token on Basescan
                </a>
                <div className={`mt-1.5 font-mono text-[9px] ${txt4}`}>All transactions publicly verifiable</div>
              </div>
            </div>
          </section>

          {/* Footer */}
          <div className={`flex items-center gap-4 border-t pt-6 font-mono text-[9px] tracking-widest uppercase ${footerDiv} ${txt4}`}>
            <span>nTZS Network</span>
            <div className={`w-px h-2.5 ${d ? 'bg-white/8' : 'bg-gray-300'}`} />
            <span>NEDA LABS Company Limited</span>
            <div className={`w-px h-2.5 ${d ? 'bg-white/8' : 'bg-gray-300'}`} />
            <span>Dar es Salaam, Tanzania</span>
          </div>

        </div>
      </div>
    </div>
  )
}
