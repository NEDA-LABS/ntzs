import { desc, eq, isNotNull, sql } from 'drizzle-orm'
import { ethers } from 'ethers'

import { requireRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, PLATFORM_TREASURY_ADDRESS } from '@/lib/env'
import { burnRequests, partners, users } from '@ntzs/db'
import { formatDateTimeEAT } from '@/lib/format-date'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const

async function fetchOnChainBalance(address: string): Promise<number | null> {
  if (!BASE_RPC_URL || !NTZS_CONTRACT_ADDRESS_BASE) return null
  if (!ethers.isAddress(address)) return null
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
    const token = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, BALANCE_ABI, provider)
    const bal: bigint = await token.balanceOf(address)
    return Number(bal / BigInt(10) ** BigInt(18))
  } catch {
    return null
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function Short({ value }: { value: string | null }) {
  if (!value) return <span className="text-zinc-600">—</span>
  return (
    <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs text-zinc-400">
      {value.slice(0, 10)}...{value.slice(-6)}
    </code>
  )
}

export default async function TreasuryPage() {
  await requireRole('super_admin')
  const { db } = getDb()

  const treasuryAddress = PLATFORM_TREASURY_ADDRESS
  const treasuryConfigured = ethers.isAddress(treasuryAddress)

  // ── Aggregate fee metrics ────────────────────────────────────────────────
  const [feeStats] = await db
    .select({
      totalCollectedTzs: sql<number>`coalesce(sum(${burnRequests.platformFeeTzs}), 0)`.mapWith(Number),
      realizedTzs: sql<number>`coalesce(sum(case when ${burnRequests.feeTxHash} is not null then ${burnRequests.platformFeeTzs} else 0 end), 0)`.mapWith(Number),
      pendingTzs: sql<number>`coalesce(sum(case when ${burnRequests.feeTxHash} is null and ${burnRequests.status} = 'burned' and ${burnRequests.platformFeeTzs} > 0 then ${burnRequests.platformFeeTzs} else 0 end), 0)`.mapWith(Number),
      burnCount: sql<number>`count(case when ${burnRequests.platformFeeTzs} > 0 then 1 end)`.mapWith(Number),
    })
    .from(burnRequests)

  // ── Fees grouped by recipient (global vs per-partner) ────────────────────
  const feesByRecipient = await db
    .select({
      recipient: burnRequests.feeRecipientAddress,
      totalTzs: sql<number>`coalesce(sum(${burnRequests.platformFeeTzs}), 0)`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(burnRequests)
    .where(isNotNull(burnRequests.feeTxHash))
    .groupBy(burnRequests.feeRecipientAddress)
    .orderBy(desc(sql`sum(${burnRequests.platformFeeTzs})`))

  // ── Recent fee-mint transactions ─────────────────────────────────────────
  const recentFeeMints = await db
    .select({
      id: burnRequests.id,
      amountTzs: burnRequests.amountTzs,
      platformFeeTzs: burnRequests.platformFeeTzs,
      feeTxHash: burnRequests.feeTxHash,
      feeRecipientAddress: burnRequests.feeRecipientAddress,
      txHash: burnRequests.txHash,
      createdAt: burnRequests.createdAt,
      userEmail: users.email,
    })
    .from(burnRequests)
    .leftJoin(users, eq(users.id, burnRequests.userId))
    .where(isNotNull(burnRequests.feeTxHash))
    .orderBy(desc(burnRequests.createdAt))
    .limit(25)

  // ── Unrealized fees (burn succeeded but fee mint missing) ────────────────
  const unrealizedFees = await db
    .select({
      id: burnRequests.id,
      amountTzs: burnRequests.amountTzs,
      platformFeeTzs: burnRequests.platformFeeTzs,
      txHash: burnRequests.txHash,
      createdAt: burnRequests.createdAt,
      userEmail: users.email,
    })
    .from(burnRequests)
    .leftJoin(users, eq(users.id, burnRequests.userId))
    .where(sql`${burnRequests.feeTxHash} is null and ${burnRequests.status} = 'burned' and coalesce(${burnRequests.platformFeeTzs}, 0) > 0`)
    .orderBy(desc(burnRequests.createdAt))
    .limit(25)

  // ── On-chain balances ────────────────────────────────────────────────────
  const platformBalance = treasuryConfigured ? await fetchOnChainBalance(treasuryAddress) : null

  const partnersWithTreasury = await db
    .select({
      id: partners.id,
      name: partners.name,
      treasuryWalletAddress: partners.treasuryWalletAddress,
      feePercent: partners.feePercent,
    })
    .from(partners)
    .where(isNotNull(partners.treasuryWalletAddress))
    .orderBy(desc(partners.createdAt))

  const partnerBalances = await Promise.all(
    partnersWithTreasury.map(async (p) => ({
      ...p,
      balance: await fetchOnChainBalance(p.treasuryWalletAddress!),
    }))
  )

  return (
    <main className="space-y-6 p-6">
      {/* Header */}
      <section>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Treasury</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Platform fees and profits — collected from withdrawal gross-up spreads
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-violet-500/10 px-4 py-2 ring-1 ring-violet-500/20">
            <span className="text-sm font-medium text-violet-300">Super Admin Only</span>
          </div>
        </div>
      </section>

      {/* Configuration warning */}
      {!treasuryConfigured && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
          <h2 className="text-lg font-semibold text-amber-300">Treasury not configured</h2>
          <p className="mt-2 text-sm text-amber-100/80">
            The <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono">PLATFORM_TREASURY_ADDRESS</code> environment variable is not set.
            While unset, platform fees remain as <strong>implicit reserve surplus</strong> in your Snippe balance
            instead of being minted as on-chain nTZS to a dedicated wallet.
          </p>
          <div className="mt-4 rounded-xl bg-black/40 p-4 text-xs text-zinc-300 font-mono">
            <p className="text-zinc-500 mb-2"># Generate a fresh treasury wallet</p>
            <p>node scripts/generate-platform-treasury.mjs</p>
            <p className="text-zinc-500 mt-3 mb-2"># Then set in Vercel + worker env</p>
            <p>PLATFORM_TREASURY_ADDRESS=0x...</p>
          </div>
        </section>
      )}

      {/* Primary metrics */}
      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard
          title="Total Fees Collected"
          value={`${formatNumber(feeStats?.totalCollectedTzs ?? 0)} TZS`}
          subtitle={`${feeStats?.burnCount ?? 0} fee-bearing withdrawals`}
          color="violet"
        />
        <MetricCard
          title="Realized On-Chain"
          value={`${formatNumber(feeStats?.realizedTzs ?? 0)} TZS`}
          subtitle="Minted to treasury"
          color="emerald"
        />
        <MetricCard
          title="Pending Mint"
          value={`${formatNumber(feeStats?.pendingTzs ?? 0)} TZS`}
          subtitle="Fee-mint failed or not attempted"
          color={feeStats?.pendingTzs ? 'amber' : 'zinc'}
        />
        <MetricCard
          title="Platform Treasury Balance"
          value={platformBalance != null ? `${formatNumber(platformBalance)} nTZS` : '—'}
          subtitle={treasuryConfigured ? 'Live on Base Mainnet' : 'Not configured'}
          color="blue"
        />
      </section>

      {/* Platform treasury wallet */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-lg font-semibold text-white">Platform Treasury Wallet</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Fallback treasury for end-user withdrawals and partner withdrawals where no partner treasury is configured.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Address</p>
            {treasuryConfigured ? (
              <a
                href={`https://basescan.org/address/${treasuryAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block break-all font-mono text-sm text-blue-400 hover:text-blue-300"
              >
                {treasuryAddress}
              </a>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">Not configured</p>
            )}
            <p className="mt-2 text-xs text-zinc-500">From env: PLATFORM_TREASURY_ADDRESS</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Live Balance</p>
            <p className="mt-2 text-2xl font-bold text-white">
              {platformBalance != null ? `${formatNumber(platformBalance)}` : '—'}
            </p>
            <p className="mt-1 text-xs text-zinc-500">nTZS · fetched from Base Mainnet</p>
          </div>
        </div>
      </section>

      {/* Partner treasuries */}
      {partnerBalances.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold text-white">Partner Treasuries</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Partners with their own treasury address receive fees directly.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <th className="pb-3 pr-4">Partner</th>
                  <th className="pb-3 pr-4">Fee %</th>
                  <th className="pb-3 pr-4">Treasury Address</th>
                  <th className="pb-3">Live Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {partnerBalances.map((p) => (
                  <tr key={p.id} className="text-sm">
                    <td className="py-3 pr-4 text-zinc-300">{p.name}</td>
                    <td className="py-3 pr-4 font-mono text-zinc-300">{p.feePercent}%</td>
                    <td className="py-3 pr-4">
                      <a
                        href={`https://basescan.org/address/${p.treasuryWalletAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-xs text-blue-400 hover:bg-blue-500/20"
                      >
                        {p.treasuryWalletAddress?.slice(0, 10)}...{p.treasuryWalletAddress?.slice(-6)}
                      </a>
                    </td>
                    <td className="py-3 font-medium text-white">
                      {p.balance != null ? `${formatNumber(p.balance)} nTZS` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Fees by recipient */}
      {feesByRecipient.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold text-white">Realized Fees by Recipient</h2>
          <p className="mt-1 text-sm text-zinc-400">Cumulative nTZS minted to each treasury address.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <th className="pb-3 pr-4">Recipient</th>
                  <th className="pb-3 pr-4">Withdrawals</th>
                  <th className="pb-3">Total Fees (TZS)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {feesByRecipient.map((row) => {
                  const isPlatform =
                    treasuryConfigured &&
                    row.recipient?.toLowerCase() === treasuryAddress.toLowerCase()
                  return (
                    <tr key={row.recipient ?? 'none'} className="text-sm">
                      <td className="py-3 pr-4">
                        {row.recipient ? (
                          <div className="flex items-center gap-2">
                            <a
                              href={`https://basescan.org/address/${row.recipient}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-xs text-blue-400 hover:bg-blue-500/20"
                            >
                              {row.recipient.slice(0, 10)}...{row.recipient.slice(-6)}
                            </a>
                            {isPlatform && (
                              <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-xs font-medium text-violet-300">
                                Platform
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-zinc-300">{row.count}</td>
                      <td className="py-3 font-mono font-medium text-emerald-400">
                        +{formatNumber(row.totalTzs)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent fee mints */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-lg font-semibold text-white">Recent Fee Mints</h2>
        <p className="mt-1 text-sm text-zinc-400">Last 25 withdrawals with on-chain fee allocation.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="pb-3 pr-4">When</th>
                <th className="pb-3 pr-4">User</th>
                <th className="pb-3 pr-4">Burn (TZS)</th>
                <th className="pb-3 pr-4">Fee (TZS)</th>
                <th className="pb-3 pr-4">Recipient</th>
                <th className="pb-3 pr-4">Burn TX</th>
                <th className="pb-3">Fee TX</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {recentFeeMints.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-zinc-500">
                    No fee mints recorded yet.
                  </td>
                </tr>
              ) : (
                recentFeeMints.map((r) => (
                  <tr key={r.id} className="text-sm">
                    <td className="py-3 pr-4 text-xs text-zinc-500">{formatDateTimeEAT(r.createdAt)}</td>
                    <td className="py-3 pr-4 text-zinc-300">{r.userEmail ?? '—'}</td>
                    <td className="py-3 pr-4 font-medium text-white">{formatNumber(r.amountTzs)}</td>
                    <td className="py-3 pr-4 font-mono text-emerald-400">
                      +{formatNumber(r.platformFeeTzs ?? 0)}
                    </td>
                    <td className="py-3 pr-4">
                      {r.feeRecipientAddress ? (
                        <a
                          href={`https://basescan.org/address/${r.feeRecipientAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-xs text-blue-400 hover:bg-blue-500/20"
                        >
                          {r.feeRecipientAddress.slice(0, 8)}...{r.feeRecipientAddress.slice(-4)}
                        </a>
                      ) : (
                        <Short value={null} />
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {r.txHash ? (
                        <a
                          href={`https://basescan.org/tx/${r.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-xs text-blue-400 hover:bg-blue-500/20"
                        >
                          {r.txHash.slice(0, 10)}...
                        </a>
                      ) : (
                        <Short value={null} />
                      )}
                    </td>
                    <td className="py-3">
                      {r.feeTxHash ? (
                        <a
                          href={`https://basescan.org/tx/${r.feeTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-xs text-emerald-400 hover:bg-emerald-500/20"
                        >
                          {r.feeTxHash.slice(0, 10)}...
                        </a>
                      ) : (
                        <Short value={null} />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Unrealized fees */}
      {unrealizedFees.length > 0 && (
        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
          <h2 className="text-lg font-semibold text-amber-300">Unrealized Fees</h2>
          <p className="mt-1 text-sm text-amber-100/70">
            Withdrawals where the burn succeeded but the fee-mint did not. These fees are held as
            implicit reserve surplus and can be reconciled manually.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-amber-500/20 text-left text-xs font-medium uppercase tracking-wide text-amber-300/60">
                  <th className="pb-3 pr-4">When</th>
                  <th className="pb-3 pr-4">User</th>
                  <th className="pb-3 pr-4">Burn (TZS)</th>
                  <th className="pb-3 pr-4">Pending Fee (TZS)</th>
                  <th className="pb-3">Burn TX</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-500/10">
                {unrealizedFees.map((r) => (
                  <tr key={r.id} className="text-sm">
                    <td className="py-3 pr-4 text-xs text-zinc-500">{formatDateTimeEAT(r.createdAt)}</td>
                    <td className="py-3 pr-4 text-zinc-300">{r.userEmail ?? '—'}</td>
                    <td className="py-3 pr-4 font-medium text-white">{formatNumber(r.amountTzs)}</td>
                    <td className="py-3 pr-4 font-mono text-amber-300">
                      {formatNumber(r.platformFeeTzs ?? 0)}
                    </td>
                    <td className="py-3">
                      {r.txHash ? (
                        <a
                          href={`https://basescan.org/tx/${r.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-xs text-blue-400 hover:bg-blue-500/20"
                        >
                          {r.txHash.slice(0, 10)}...
                        </a>
                      ) : (
                        <Short value={null} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  )
}

// ─── UI helpers ────────────────────────────────────────────────────────────

type MetricColor = 'emerald' | 'violet' | 'amber' | 'blue' | 'zinc'

function MetricCard({
  title,
  value,
  subtitle,
  color = 'zinc',
}: {
  title: string
  value: string
  subtitle?: string
  color?: MetricColor
}) {
  const ring: Record<MetricColor, string> = {
    emerald: 'ring-emerald-500/20',
    violet: 'ring-violet-500/20',
    amber: 'ring-amber-500/20',
    blue: 'ring-blue-500/20',
    zinc: 'ring-white/10',
  }
  const accent: Record<MetricColor, string> = {
    emerald: 'text-emerald-400',
    violet: 'text-violet-400',
    amber: 'text-amber-400',
    blue: 'text-blue-400',
    zinc: 'text-zinc-300',
  }
  return (
    <div className={`rounded-2xl bg-white/[0.03] p-5 ring-1 ${ring[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</p>
      <p className={`mt-2 text-2xl font-bold ${accent[color]}`}>{value}</p>
      {subtitle && <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>}
    </div>
  )
}
