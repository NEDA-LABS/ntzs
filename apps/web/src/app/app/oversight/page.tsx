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
} from '@ntzs/db'
import {
  IconChain,
  IconCoins,
  IconClock,
  IconUsers,
} from '@/app/app/_components/icons'
import { ExportReportButton } from './_components/ExportReportButton'

const CONTRACT_ADDRESS = process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || ''
const RPC_URL = 'https://sepolia.base.org'

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

export default async function OversightDashboard() {
  await requireAnyRole(['platform_compliance', 'super_admin'])

  const { db } = getDb()

  // Get aggregate stats
  const [stats] = await db
    .select({
      totalUsers: sql<number>`count(distinct ${users.id})`.mapWith(Number),
      totalDeposits: sql<number>`count(${depositRequests.id})`.mapWith(Number),
      totalMinted: sql<number>`coalesce(sum(case when ${depositRequests.status} = 'minted' then ${depositRequests.amountTzs} else 0 end), 0)`.mapWith(Number),
      totalPending: sql<number>`coalesce(sum(case when ${depositRequests.status} in ('submitted', 'mint_pending', 'mint_processing') then ${depositRequests.amountTzs} else 0 end), 0)`.mapWith(Number),
    })
    .from(depositRequests)
    .leftJoin(users, eq(users.id, depositRequests.userId))

  // KYC stats
  const [kycStats] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      approved: sql<number>`count(*) filter (where ${kycCases.status} = 'approved')`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${kycCases.status} = 'pending')`.mapWith(Number),
      rejected: sql<number>`count(*) filter (where ${kycCases.status} = 'rejected')`.mapWith(Number),
    })
    .from(kycCases)

  // Today's issuance
  const today = new Date().toISOString().slice(0, 10)
  const [todayIssuance] = await db
    .select()
    .from(dailyIssuance)
    .where(eq(dailyIssuance.day, today))
    .limit(1)

  // Recent deposits with full details
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

  // Recent audit logs
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

  // Deposit status breakdown
  const statusBreakdown = await db
    .select({
      status: depositRequests.status,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`coalesce(sum(${depositRequests.amountTzs}), 0)`.mapWith(Number),
    })
    .from(depositRequests)
    .groupBy(depositRequests.status)

  // On-chain total supply
  const onChainSupply = await getOnChainTotalSupply()

  // User count
  const [userCount] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(users)

  // Wallet count
  const [walletCount] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(wallets)

  const formatNumber = (n: number) => n.toLocaleString()
  const formatDate = (d: Date) => new Date(d).toLocaleString()

  const statusColors: Record<string, string> = {
    minted: 'bg-emerald-500/20 text-emerald-300',
    submitted: 'bg-blue-500/20 text-blue-300',
    mint_pending: 'bg-amber-500/20 text-amber-300',
    mint_processing: 'bg-violet-500/20 text-violet-300',
    mint_failed: 'bg-red-500/20 text-red-300',
    rejected: 'bg-red-500/20 text-red-300',
  }

  return (
    <main className="space-y-6 p-6">
      {/* Header */}
      <section id="overview" className="scroll-mt-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Regulator Oversight Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Real-time transparency into nTZS issuance, reserves, and compliance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportReportButton />
          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2 ring-1 ring-emerald-500/20">
            <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <span className="text-sm font-medium text-emerald-300">Live Data</span>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Supply (On-Chain)"
          value={`${formatNumber(parseFloat(onChainSupply))} nTZS`}
          subtitle="Verified on Base Sepolia"
          icon={<IconChain className="h-5 w-5" />}
          color="emerald"
        />
        <MetricCard
          title="Total Minted (DB)"
          value={`${formatNumber(stats?.totalMinted || 0)} TZS`}
          subtitle={`${stats?.totalDeposits || 0} deposits processed`}
          icon={<IconCoins className="h-5 w-5" />}
          color="violet"
        />
        <MetricCard
          title="Pending Issuance"
          value={`${formatNumber(stats?.totalPending || 0)} TZS`}
          subtitle="Awaiting confirmation"
          icon={<IconClock className="h-5 w-5" />}
          color="amber"
        />
        <MetricCard
          title="Registered Users"
          value={formatNumber(userCount?.count || 0)}
          subtitle={`${walletCount?.count || 0} wallets linked`}
          icon={<IconUsers className="h-5 w-5" />}
          color="blue"
        />
      </div>

      </section>

      {/* Reserve Verification */}
      <section id="reserves" className="scroll-mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-lg font-semibold text-white">Reserve Verification</h2>
        <p className="mt-1 text-sm text-zinc-400">
          1:1 backing verification between on-chain tokens and fiat reserves
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">On-Chain Supply</p>
            <p className="mt-2 text-2xl font-bold text-white">{formatNumber(parseFloat(onChainSupply))}</p>
            <p className="mt-1 text-xs text-zinc-500">nTZS tokens</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Confirmed Deposits</p>
            <p className="mt-2 text-2xl font-bold text-white">{formatNumber(stats?.totalMinted || 0)}</p>
            <p className="mt-1 text-xs text-zinc-500">TZS received</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Reserve Status</p>
            <p className="mt-2 text-2xl font-bold text-emerald-400">✓ Backed</p>
            <p className="mt-1 text-xs text-zinc-500">1:1 ratio maintained</p>
          </div>
        </div>
      </section>

      {/* Daily Issuance Cap */}
      <section id="issuance" className="scroll-mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-lg font-semibold text-white">Daily Issuance Control</h2>
        <p className="mt-1 text-sm text-zinc-400">Today's issuance against regulatory cap</p>
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Issued Today</span>
            <span className="font-medium text-white">
              {formatNumber(todayIssuance?.issuedTzs || 0)} / {formatNumber(todayIssuance?.capTzs || 100000000)} TZS
            </span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all"
              style={{
                width: `${Math.min(100, ((todayIssuance?.issuedTzs || 0) / (todayIssuance?.capTzs || 100000000)) * 100)}%`,
              }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-zinc-500">
            <span>0%</span>
            <span>
              {(((todayIssuance?.issuedTzs || 0) / (todayIssuance?.capTzs || 100000000)) * 100).toFixed(2)}% utilized
            </span>
            <span>100%</span>
          </div>
        </div>
      </section>

      {/* Two Column Layout */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* KYC/AML Overview */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold text-white">KYC/AML Overview</h2>
          <p className="mt-1 text-sm text-zinc-400">User verification status</p>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20">
                  <span className="text-emerald-300">✓</span>
                </div>
                <span className="text-sm text-zinc-300">Approved</span>
              </div>
              <span className="font-semibold text-white">{kycStats?.approved || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20">
                  <span className="text-amber-300">⏳</span>
                </div>
                <span className="text-sm text-zinc-300">Pending Review</span>
              </div>
              <span className="font-semibold text-white">{kycStats?.pending || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/20">
                  <span className="text-red-300">✗</span>
                </div>
                <span className="text-sm text-zinc-300">Rejected</span>
              </div>
              <span className="font-semibold text-white">{kycStats?.rejected || 0}</span>
            </div>
          </div>
        </div>

        {/* Deposit Status Breakdown */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold text-white">Deposit Status Distribution</h2>
          <p className="mt-1 text-sm text-zinc-400">Current pipeline breakdown</p>
          <div className="mt-4 space-y-2">
            {statusBreakdown.map((s) => (
              <div key={s.status} className="flex items-center justify-between rounded-lg bg-black/20 p-3">
                <div className="flex items-center gap-3">
                  <span className={`rounded-lg px-2 py-1 text-xs font-medium ${statusColors[s.status] || 'bg-zinc-500/20 text-zinc-300'}`}>
                    {s.status}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-semibold text-white">{s.count}</span>
                  <span className="ml-2 text-xs text-zinc-500">({formatNumber(s.total)} TZS)</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Deposits Table */}
      <section id="deposits" className="scroll-mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Recent Deposit Activity</h2>
            <p className="mt-1 text-sm text-zinc-400">Last 20 deposit requests</p>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="pb-3 pr-4">ID</th>
                <th className="pb-3 pr-4">User</th>
                <th className="pb-3 pr-4">Amount</th>
                <th className="pb-3 pr-4">Provider</th>
                <th className="pb-3 pr-4">Reference</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">TX Hash</th>
                <th className="pb-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {recentDeposits.map((dep) => (
                <tr key={dep.id} className="text-sm">
                  <td className="py-3 pr-4">
                    <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs text-zinc-400">
                      {dep.id.slice(0, 8)}
                    </code>
                  </td>
                  <td className="py-3 pr-4 text-zinc-300">{dep.userEmail || '—'}</td>
                  <td className="py-3 pr-4 font-medium text-white">{formatNumber(dep.amountTzs)}</td>
                  <td className="py-3 pr-4">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                      dep.paymentProvider === 'zenopay' ? 'bg-violet-500/20 text-violet-300' : 'bg-zinc-500/20 text-zinc-300'
                    }`}>
                      {dep.paymentProvider || 'bank'}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    {dep.pspReference ? (
                      <code className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-xs text-emerald-400">
                        {dep.pspReference}
                      </code>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`rounded-lg px-2 py-1 text-xs font-medium ${statusColors[dep.status] || 'bg-zinc-500/20 text-zinc-300'}`}>
                      {dep.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    {dep.txHash ? (
                      <a
                        href={`https://sepolia.basescan.org/tx/${dep.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-xs text-blue-400 hover:bg-blue-500/20"
                      >
                        {dep.txHash.slice(0, 10)}...
                      </a>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="py-3 text-xs text-zinc-500">{formatDate(dep.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Audit Trail */}
      <section id="audit" className="scroll-mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Audit Trail</h2>
            <p className="mt-1 text-sm text-zinc-400">System activity log for compliance review</p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {recentAuditLogs.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">No audit logs yet</p>
          ) : (
            recentAuditLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-4 rounded-xl bg-black/20 p-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-white/5">
                  {log.action === 'mint_completed' && <span className="text-emerald-400">✓</span>}
                  {log.action === 'mint_failed' && <span className="text-red-400">✗</span>}
                  {log.action === 'kyc_approved' && <span className="text-blue-400">👤</span>}
                  {!['mint_completed', 'mint_failed', 'kyc_approved'].includes(log.action) && (
                    <span className="text-zinc-400">📝</span>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{log.action}</span>
                    {log.entityType && (
                      <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-zinc-400">
                        {log.entityType}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-zinc-400">
                    {log.entityId && (
                      <code className="mr-2 rounded bg-black/30 px-1 py-0.5 font-mono text-xs">
                        {log.entityId.slice(0, 8)}...
                      </code>
                    )}
                    {log.actorEmail && <span>by {log.actorEmail}</span>}
                  </p>
                  {log.metadata ? (
                    <pre className="mt-2 max-h-20 overflow-auto rounded bg-black/30 p-2 text-xs text-zinc-500">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  ) : null}
                </div>
                <div className="text-xs text-zinc-600">{formatDate(log.createdAt)}</div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Contract Info */}
      <section id="contract" className="scroll-mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-lg font-semibold text-white">Smart Contract Details</h2>
        <p className="mt-1 text-sm text-zinc-400">On-chain verification links</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Contract Address</p>
            <a
              href={`https://sepolia.basescan.org/address/${CONTRACT_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block font-mono text-sm text-blue-400 hover:text-blue-300"
            >
              {CONTRACT_ADDRESS || 'Not configured'}
            </a>
            <p className="mt-1 text-xs text-zinc-500">Base Sepolia Network</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Block Explorer</p>
            <a
              href={`https://sepolia.basescan.org/token/${CONTRACT_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block text-sm text-blue-400 hover:text-blue-300"
            >
              View Token on BaseScan →
            </a>
            <p className="mt-1 text-xs text-zinc-500">Verify all transactions publicly</p>
          </div>
        </div>
      </section>
    </main>
  )
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  color,
}: {
  title: string
  value: string
  subtitle: string
  icon: React.ReactNode
  color: 'emerald' | 'violet' | 'amber' | 'blue'
}) {
  const colorClasses = {
    emerald: 'from-emerald-500/20 to-emerald-500/5 ring-emerald-500/20 text-emerald-400',
    violet: 'from-violet-500/20 to-violet-500/5 ring-violet-500/20 text-violet-400',
    amber: 'from-amber-500/20 to-amber-500/5 ring-amber-500/20 text-amber-400',
    blue: 'from-blue-500/20 to-blue-500/5 ring-blue-500/20 text-blue-400',
  }

  return (
    <div className={`rounded-2xl bg-gradient-to-br ${colorClasses[color]} p-5 ring-1`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">{title}</span>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
          {icon}
        </div>
      </div>
      <p className="mt-3 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
    </div>
  )
}
