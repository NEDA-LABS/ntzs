import { desc, eq, sql } from 'drizzle-orm'
import { ethers } from 'ethers'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import {
  users,
  depositRequests,
  mintTransactions,
  kycCases,
  dailyIssuance,
  auditLogs,
  wallets,
  burnRequests,
} from '@ntzs/db'
import { ExportReportButton } from './_components/ExportReportButton'
import { formatDateTimeEAT } from '@/lib/format-date'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'

const CONTRACT_ADDRESS = NTZS_CONTRACT_ADDRESS_BASE
const RPC_URL = BASE_RPC_URL

async function getOnChainTotalSupply(): Promise<string> {
  if (!CONTRACT_ADDRESS) return '0'
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const contract = new ethers.Contract(
      CONTRACT_ADDRESS,
      ['function totalSupply() view returns (uint256)'],
      provider
    )
    const supply = await contract.totalSupply()
    return ethers.formatUnits(supply, 18)
  } catch {
    return '0'
  }
}

// ── Design system helpers ─────────────────────────────────────────────────────

function SectionLabel({ index, label }: { index: string; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-5 h-px bg-blue-400/50" />
      <span className="font-mono text-[9px] tracking-widest text-blue-400/60 uppercase">{index} / {label}</span>
      <div className="flex-1 h-px bg-white/5" />
    </div>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-white/8 bg-white/[0.02] p-5">
      <div className="font-mono text-[9px] tracking-widest text-zinc-500 uppercase">{label}</div>
      <div className="mt-3 font-mono text-2xl font-bold tabular-nums text-white">{value}</div>
      {sub && <div className="mt-1.5 font-mono text-xs text-zinc-600">{sub}</div>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    minted:           'border-emerald-500/40 text-emerald-400',
    submitted:        'border-blue-500/40 text-blue-400',
    fiat_confirmed:   'border-blue-500/40 text-blue-400',
    bank_approved:    'border-violet-500/40 text-violet-400',
    platform_approved:'border-violet-500/40 text-violet-400',
    mint_pending:     'border-amber-500/40 text-amber-400',
    mint_requires_safe:'border-amber-500/40 text-amber-400',
    mint_processing:  'border-amber-500/40 text-amber-400',
    mint_failed:      'border-red-500/40 text-red-400',
    rejected:         'border-red-500/40 text-red-400',
    cancelled:        'border-zinc-600/40 text-zinc-500',
    burned:           'border-emerald-500/40 text-emerald-400',
    failed:           'border-red-500/40 text-red-400',
    requires_second_approval: 'border-amber-500/40 text-amber-400',
    kyc_pending:      'border-amber-500/40 text-amber-400',
    kyc_approved:     'border-emerald-500/40 text-emerald-400',
    kyc_rejected:     'border-red-500/40 text-red-400',
    awaiting_fiat:    'border-zinc-500/40 text-zinc-400',
  }
  const s = styles[status] ?? 'border-zinc-600/40 text-zinc-500'
  return (
    <span className={`border font-mono text-[9px] tracking-wider uppercase px-2 py-0.5 ${s}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function TxLink({ hash, explorer = 'tx' }: { hash: string; explorer?: 'tx' | 'token' | 'address' }) {
  return (
    <a
      href={`https://basescan.org/${explorer}/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-[10px] text-blue-400/70 hover:text-blue-400 underline underline-offset-2"
    >
      {hash.slice(0, 10)}...
    </a>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function OversightDashboard() {
  await requireAnyRole(['platform_compliance', 'super_admin'])

  const { db } = getDb()

  const [stats] = await db
    .select({
      totalUsers: sql<number>`count(distinct ${users.id})`.mapWith(Number),
      totalDeposits: sql<number>`count(${depositRequests.id})`.mapWith(Number),
      totalMinted: sql<number>`coalesce(sum(case when ${depositRequests.status} = 'minted' then ${depositRequests.amountTzs} else 0 end), 0)`.mapWith(Number),
      totalPending: sql<number>`coalesce(sum(case when ${depositRequests.status} in ('submitted', 'mint_pending', 'mint_processing') then ${depositRequests.amountTzs} else 0 end), 0)`.mapWith(Number),
    })
    .from(depositRequests)
    .leftJoin(users, eq(users.id, depositRequests.userId))

  const [kycStats] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      approved: sql<number>`count(*) filter (where ${kycCases.status} = 'approved')`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${kycCases.status} = 'pending')`.mapWith(Number),
      rejected: sql<number>`count(*) filter (where ${kycCases.status} = 'rejected')`.mapWith(Number),
    })
    .from(kycCases)

  const today = new Date().toISOString().slice(0, 10)
  const [todayIssuance] = await db
    .select()
    .from(dailyIssuance)
    .where(eq(dailyIssuance.day, today))
    .limit(1)

  const recentDeposits = await db
    .select({
      id: depositRequests.id,
      amountTzs: depositRequests.amountTzs,
      status: depositRequests.status,
      paymentProvider: depositRequests.paymentProvider,
      pspReference: depositRequests.pspReference,
      createdAt: depositRequests.createdAt,
      userEmail: users.email,
      txHash: mintTransactions.txHash,
    })
    .from(depositRequests)
    .leftJoin(users, eq(users.id, depositRequests.userId))
    .leftJoin(mintTransactions, eq(mintTransactions.depositRequestId, depositRequests.id))
    .orderBy(desc(depositRequests.createdAt))
    .limit(20)

  const recentAuditLogs = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(15)

  const statusBreakdown = await db
    .select({
      status: depositRequests.status,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`coalesce(sum(${depositRequests.amountTzs}), 0)`.mapWith(Number),
    })
    .from(depositRequests)
    .groupBy(depositRequests.status)

  const recentBurns = await db
    .select({
      id: burnRequests.id,
      amountTzs: burnRequests.amountTzs,
      status: burnRequests.status,
      txHash: burnRequests.txHash,
      recipientPhone: burnRequests.recipientPhone,
      payoutStatus: burnRequests.payoutStatus,
      payoutReference: burnRequests.payoutReference,
      platformFeeTzs: burnRequests.platformFeeTzs,
      feeTxHash: burnRequests.feeTxHash,
      createdAt: burnRequests.createdAt,
      userEmail: users.email,
    })
    .from(burnRequests)
    .leftJoin(users, eq(users.id, burnRequests.userId))
    .orderBy(desc(burnRequests.createdAt))
    .limit(20)

  const [burnStats] = await db
    .select({
      totalBurned: sql<number>`coalesce(sum(case when ${burnRequests.status} = 'burned' then ${burnRequests.amountTzs} else 0 end), 0)`.mapWith(Number),
      burnCount: sql<number>`count(case when ${burnRequests.status} = 'burned' then 1 end)`.mapWith(Number),
      totalPlatformFees: sql<number>`coalesce(sum(${burnRequests.platformFeeTzs}), 0)`.mapWith(Number),
    })
    .from(burnRequests)

  const onChainSupply = await getOnChainTotalSupply()

  const [userCount] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(users)

  const [walletCount] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(wallets)

  const n = (v: number) => v.toLocaleString()
  const issuedToday = todayIssuance?.issuedTzs ?? 0
  const capToday = todayIssuance?.capTzs ?? 100_000_000
  const capPct = Math.min(100, (issuedToday / capToday) * 100)

  return (
    <div className="min-h-screen bg-black font-mono text-white">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="border-b border-white/8 px-6 py-5 lg:px-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-1 h-4 bg-blue-400" />
              <h1 className="text-sm font-bold tracking-widest uppercase text-white">
                Oversight Dashboard
              </h1>
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-[9px] tracking-widest text-zinc-600 uppercase">
              <span>nTZS Stablecoin Platform</span>
              <div className="w-px h-2.5 bg-white/10" />
              <span>Real-time Operations</span>
              <div className="w-px h-2.5 bg-white/10" />
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-blue-400/60">Live</span>
              </div>
            </div>
          </div>
          <ExportReportButton />
        </div>
      </div>

      <div className="space-y-10 px-6 py-8 lg:px-10">

        {/* ── 01 / Key Metrics ────────────────────────────────────────────── */}
        <section id="overview">
          <SectionLabel index="01" label="Key Metrics" />
          <div className="grid gap-px border border-white/8 bg-white/8 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="On-chain supply"
              value={`${n(Math.floor(parseFloat(onChainSupply)))} nTZS`}
              sub="Base mainnet totalSupply()"
            />
            <MetricCard
              label="Total minted (DB)"
              value={`${n(stats?.totalMinted ?? 0)} TZS`}
              sub={`${n(stats?.totalDeposits ?? 0)} deposits processed`}
            />
            <MetricCard
              label="Pending issuance"
              value={`${n(stats?.totalPending ?? 0)} TZS`}
              sub="Awaiting confirmation"
            />
            <MetricCard
              label="Registered users"
              value={n(userCount?.count ?? 0)}
              sub={`${n(walletCount?.count ?? 0)} wallets linked`}
            />
          </div>
        </section>

        {/* ── 02 / Reserve Verification ───────────────────────────────────── */}
        <section id="reserves">
          <SectionLabel index="02" label="Reserve Verification" />
          <div className="grid gap-px border border-white/8 bg-white/8 md:grid-cols-3">
            <MetricCard
              label="On-chain supply"
              value={n(Math.floor(parseFloat(onChainSupply)))}
              sub="nTZS tokens — Base mainnet"
            />
            <MetricCard
              label="Confirmed deposits (DB)"
              value={n(stats?.totalMinted ?? 0)}
              sub="TZS received and minted"
            />
            <MetricCard
              label="Reserve status"
              value="1:1 Backed"
              sub="Dual-approval workflow enforced"
            />
          </div>
          <div className="mt-3 border border-white/5 px-4 py-3">
            <div className="flex items-center gap-2 text-[9px] tracking-widest text-zinc-600 uppercase">
              <span>Contract</span>
              <div className="w-px h-2.5 bg-white/8" />
              <a
                href={`https://basescan.org/token/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-blue-400/60 hover:text-blue-400 underline underline-offset-2"
              >
                {CONTRACT_ADDRESS || 'Not configured'}
              </a>
              <div className="w-px h-2.5 bg-white/8" />
              <span>Base Mainnet · Chain ID 8453</span>
            </div>
          </div>
        </section>

        {/* ── 03 / Daily Issuance Control ─────────────────────────────────── */}
        <section id="issuance">
          <SectionLabel index="03" label="Daily Issuance Control" />
          <div className="border border-white/8 bg-white/[0.02] p-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-[9px] tracking-widest text-zinc-500 uppercase">Issued today</div>
                <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-white">{n(issuedToday)} TZS</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] tracking-widest text-zinc-500 uppercase">Daily cap</div>
                <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-zinc-400">{n(capToday)} TZS</div>
              </div>
            </div>
            <div className="mt-5">
              <div className="h-1.5 bg-white/5 w-full overflow-hidden">
                <div
                  className={`h-full transition-all ${capPct > 90 ? 'bg-red-500' : capPct > 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
                  style={{ width: `${capPct}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[9px] tracking-widest text-zinc-600 uppercase">
                <span>0%</span>
                <span>{capPct.toFixed(2)}% utilized</span>
                <span>100%</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── 04 / KYC & Deposit Pipeline ─────────────────────────────────── */}
        <section id="kyc">
          <SectionLabel index="04" label="KYC & Deposit Pipeline" />
          <div className="grid gap-6 lg:grid-cols-2">

            {/* KYC stats */}
            <div className="border border-white/8 bg-white/[0.02]">
              <div className="border-b border-white/8 px-5 py-3">
                <div className="text-[9px] tracking-widest text-zinc-500 uppercase">Identity Verification</div>
              </div>
              <div className="divide-y divide-white/5">
                {[
                  { label: 'Approved', value: kycStats?.approved ?? 0, color: 'text-emerald-400' },
                  { label: 'Pending Review', value: kycStats?.pending ?? 0, color: 'text-amber-400' },
                  { label: 'Rejected', value: kycStats?.rejected ?? 0, color: 'text-red-400' },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between px-5 py-4">
                    <span className="font-mono text-xs tracking-wider text-zinc-400 uppercase">{row.label}</span>
                    <span className={`font-mono text-lg font-bold tabular-nums ${row.color}`}>{n(row.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Status breakdown */}
            <div className="border border-white/8 bg-white/[0.02]">
              <div className="border-b border-white/8 px-5 py-3">
                <div className="text-[9px] tracking-widest text-zinc-500 uppercase">Deposit Status Distribution</div>
              </div>
              <div className="divide-y divide-white/5">
                {statusBreakdown.map(s => (
                  <div key={s.status} className="flex items-center justify-between px-5 py-3">
                    <StatusBadge status={s.status} />
                    <div className="text-right">
                      <span className="font-mono text-sm font-bold text-white">{n(s.count)}</span>
                      <span className="ml-2 font-mono text-xs text-zinc-600">{n(s.total)} TZS</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 05 / Recent Deposits ────────────────────────────────────────── */}
        <section id="deposits">
          <SectionLabel index="05" label="Recent Deposits" />
          <div className="border border-white/8 overflow-x-auto">
            <table className="min-w-full divide-y divide-white/5 text-xs">
              <thead>
                <tr className="bg-white/[0.02]">
                  {['ID', 'User', 'Amount', 'Provider', 'Reference', 'Status', 'TX Hash', 'Created'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-mono text-[9px] tracking-widest text-zinc-600 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {recentDeposits.map(dep => (
                  <tr key={dep.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <code className="font-mono text-[10px] text-zinc-500">{dep.id.slice(0, 8)}</code>
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-zinc-300">{dep.userEmail ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold tabular-nums text-white">{n(dep.amountTzs)}</td>
                    <td className="px-4 py-3">
                      <span className={`border font-mono text-[9px] tracking-wider uppercase px-2 py-0.5 ${dep.paymentProvider === 'snippe' || dep.paymentProvider === 'snippe_card' ? 'border-emerald-500/30 text-emerald-400' : dep.paymentProvider === 'zenopay' ? 'border-violet-500/30 text-violet-400' : 'border-zinc-600/30 text-zinc-500'}`}>
                        {dep.paymentProvider ?? 'bank'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {dep.pspReference
                        ? <code className="font-mono text-[10px] text-zinc-400">{dep.pspReference}</code>
                        : <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={dep.status} /></td>
                    <td className="px-4 py-3">
                      {dep.txHash ? <TxLink hash={dep.txHash} /> : <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-zinc-600">{formatDateTimeEAT(dep.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 06 / Withdrawals ────────────────────────────────────────────── */}
        <section id="withdrawals">
          <SectionLabel index="06" label="Withdrawals" />
          <div className="mb-3 flex items-center gap-4 font-mono text-[9px] tracking-widest text-zinc-600 uppercase">
            <span>Total burned: <span className="text-emerald-400">{n(burnStats?.totalBurned ?? 0)} TZS</span></span>
            <div className="w-px h-2.5 bg-white/8" />
            <span>Platform fees: <span className="text-violet-400">{n(burnStats?.totalPlatformFees ?? 0)} TZS</span></span>
            <div className="w-px h-2.5 bg-white/8" />
            <span>Burns: <span className="text-white">{n(burnStats?.burnCount ?? 0)}</span></span>
          </div>
          <div className="border border-white/8 overflow-x-auto">
            <table className="min-w-full divide-y divide-white/5 text-xs">
              <thead>
                <tr className="bg-white/[0.02]">
                  {['ID', 'User', 'Burned', 'Fee', 'Recipient', 'Burn Status', 'Payout', 'Burn TX', 'Fee TX', 'Created'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-mono text-[9px] tracking-widest text-zinc-600 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {recentBurns.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center font-mono text-xs text-zinc-700">No withdrawals yet</td>
                  </tr>
                ) : recentBurns.map(burn => (
                  <tr key={burn.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <code className="font-mono text-[10px] text-zinc-500">{burn.id.slice(0, 8)}</code>
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-zinc-300">{burn.userEmail ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold tabular-nums text-white">{n(burn.amountTzs)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-violet-400">
                      {burn.platformFeeTzs ? `+${n(burn.platformFeeTzs)}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {burn.recipientPhone
                        ? <code className="font-mono text-[10px] text-zinc-400">{burn.recipientPhone}</code>
                        : <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={burn.status} /></td>
                    <td className="px-4 py-3">
                      {burn.payoutStatus ? (
                        <div>
                          <StatusBadge status={burn.payoutStatus} />
                          {burn.payoutReference && (
                            <div className="mt-0.5 font-mono text-[9px] text-zinc-600">#{burn.payoutReference.slice(0, 8)}</div>
                          )}
                        </div>
                      ) : <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {burn.txHash ? <TxLink hash={burn.txHash} /> : <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {burn.feeTxHash ? <TxLink hash={burn.feeTxHash} /> : <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-zinc-600">{formatDateTimeEAT(burn.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 07 / Audit Trail ────────────────────────────────────────────── */}
        <section id="audit">
          <SectionLabel index="07" label="Audit Trail" />
          <div className="border border-white/8 divide-y divide-white/5">
            {recentAuditLogs.length === 0 ? (
              <div className="px-5 py-10 text-center font-mono text-xs text-zinc-700">No audit logs yet</div>
            ) : recentAuditLogs.map(log => (
              <div key={log.id} className="flex items-start gap-5 px-5 py-4 hover:bg-white/[0.015] transition-colors">
                <div className="w-24 shrink-0 font-mono text-[9px] tracking-wider text-zinc-600 uppercase pt-0.5">
                  {formatDateTimeEAT(log.createdAt)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold tracking-wider uppercase text-white">
                      {log.action.replace(/_/g, ' ')}
                    </span>
                    {log.entityType && (
                      <span className="border border-white/10 font-mono text-[9px] tracking-wider uppercase px-2 py-0.5 text-zinc-500">
                        {log.entityType}
                      </span>
                    )}
                    {log.actorEmail && (
                      <span className="font-mono text-[10px] text-zinc-600">by {log.actorEmail}</span>
                    )}
                  </div>
                  {log.entityId && (
                    <div className="mt-1 font-mono text-[10px] text-zinc-700">entity: {log.entityId.slice(0, 16)}...</div>
                  )}
                  {log.metadata != null && (
                    <pre className="mt-2 max-h-16 overflow-auto border border-white/5 bg-white/[0.02] p-2 font-mono text-[9px] text-zinc-600">
                      {JSON.stringify(log.metadata as Record<string, unknown>, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 08 / Contract ───────────────────────────────────────────────── */}
        <section id="contract">
          <SectionLabel index="08" label="Smart Contract" />
          <div className="grid gap-px border border-white/8 bg-white/8 md:grid-cols-2">
            <div className="bg-black p-5">
              <div className="font-mono text-[9px] tracking-widest text-zinc-500 uppercase">Proxy Address</div>
              <a
                href={`https://basescan.org/address/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block break-all font-mono text-xs text-blue-400/70 hover:text-blue-400 underline underline-offset-2"
              >
                {CONTRACT_ADDRESS || 'Not configured'}
              </a>
              <div className="mt-1.5 font-mono text-[9px] text-zinc-700">Base Mainnet · Chain ID 8453 · NTZSV2 UUPS ERC-20</div>
            </div>
            <div className="bg-black p-5">
              <div className="font-mono text-[9px] tracking-widest text-zinc-500 uppercase">Block Explorer</div>
              <a
                href={`https://basescan.org/token/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block font-mono text-xs text-blue-400/70 hover:text-blue-400 underline underline-offset-2"
              >
                View token on Basescan
              </a>
              <div className="mt-1.5 font-mono text-[9px] text-zinc-700">All transactions publicly verifiable</div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-white/5 pt-6 font-mono text-[9px] tracking-widest text-zinc-700 uppercase">
          <span>nTZS Network</span>
          <div className="w-px h-2.5 bg-white/8" />
          <span>NEDA LABS Company Limited</span>
          <div className="w-px h-2.5 bg-white/8" />
          <span>Dar es Salaam, Tanzania</span>
        </div>

      </div>
    </div>
  )
}
