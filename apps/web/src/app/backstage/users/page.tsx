'use server'

import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { JsonRpcProvider, Contract, formatUnits } from 'ethers'

import { UserRole, requireRole, getCurrentDbUser } from '@/lib/auth/rbac'
import { SubmitButton } from '../_components/SubmitButton'
import { getDb } from '@/lib/db'
import { users, wallets, partnerUsers, partners } from '@ntzs/db'
import { writeAuditLog } from '@/lib/audit'
import { formatDateEAT } from '@/lib/format-date'

const NTZS_ADDRESS = '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]
const TOKEN_ADMIN = '/backstage/token-admin?chain=base'

// ─── Server actions ───────────────────────────────────────────────────────────

async function updateUserRoleAction(formData: FormData) {
  'use server'
  await requireRole('super_admin')
  const currentUser = await getCurrentDbUser()
  const userId = String(formData.get('userId') ?? '')
  const role = String(formData.get('role') ?? '') as UserRole
  if (!userId) throw new Error('Missing userId')
  const allowed: UserRole[] = ['end_user', 'bank_admin', 'platform_compliance', 'super_admin']
  if (!allowed.includes(role)) throw new Error('Invalid role')
  const { db } = getDb()
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId))
  await writeAuditLog('user.role_changed', 'user', userId, { newRole: role }, currentUser?.id)
  revalidatePath('/backstage/users')
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/20 text-xs font-bold text-amber-400">1</span>
  if (rank === 2) return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-400/20 text-xs font-bold text-zinc-300">2</span>
  if (rank === 3) return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-700/20 text-xs font-bold text-orange-500">3</span>
  return <span className="flex h-6 w-6 items-center justify-center text-xs text-zinc-600">{rank}</span>
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    super_admin: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
    platform_compliance: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    bank_admin: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    end_user: 'bg-zinc-500/10 text-zinc-500 border-zinc-700',
  }
  const labels: Record<string, string> = {
    super_admin: 'Super Admin',
    platform_compliance: 'Compliance',
    bank_admin: 'Bank Admin',
    end_user: 'End User',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles[role] ?? styles.end_user}`}>
      {labels[role] ?? role}
    </span>
  )
}

function fmt(n: bigint, decimals = 18): string {
  const val = parseFloat(formatUnits(n, decimals))
  if (val >= 1_000_000) return (val / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + 'M'
  if (val >= 1_000) return (val / 1_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + 'K'
  return val.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function fmtFull(n: bigint, decimals = 18): string {
  return parseFloat(formatUnits(n, decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function pct(balance: bigint, total: bigint): string {
  if (total === BigInt(0)) return '0.00'
  return ((Number(balance) / Number(total)) * 100).toFixed(2)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function UsersPage() {
  await requireRole('super_admin')
  const { db } = getDb()

  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      phone: users.phone,
      isActive: users.isActive,
      createdAt: users.createdAt,
      neonAuthUserId: users.neonAuthUserId,
      walletAddress: wallets.address,
      partnerName: partners.name,
    })
    .from(users)
    .leftJoin(wallets, eq(wallets.userId, users.id))
    .leftJoin(partnerUsers, eq(partnerUsers.userId, users.id))
    .leftJoin(partners, eq(partners.id, partnerUsers.partnerId))
    .orderBy(desc(users.createdAt))
    .limit(500)

  // ── On-chain balance fetch ──────────────────────────────────────────────────
  const rpcUrl = process.env.BASE_RPC_URL ?? ''
  const balanceMap: Record<string, bigint> = {}
  let totalSupply = BigInt(0)

  if (rpcUrl) {
    const provider = new JsonRpcProvider(rpcUrl)
    const contract = new Contract(NTZS_ADDRESS, ERC20_ABI, provider)

    const withWallet = allUsers.filter(u => u.walletAddress)
    const addresses = withWallet.map(u => u.walletAddress as string)

    const [supplyResult, ...balanceResults] = await Promise.allSettled([
      contract.totalSupply() as Promise<bigint>,
      ...addresses.map(addr => contract.balanceOf(addr) as Promise<bigint>),
    ])

    if (supplyResult.status === 'fulfilled') totalSupply = supplyResult.value
    addresses.forEach((addr, i) => {
      const r = balanceResults[i]
      balanceMap[addr.toLowerCase()] = r.status === 'fulfilled' ? r.value : BigInt(0)
    })
  }

  // ── Sort & rank ────────────────────────────────────────────────────────────
  const ranked = allUsers
    .map(u => ({
      ...u,
      balance: u.walletAddress ? (balanceMap[u.walletAddress.toLowerCase()] ?? BigInt(0)) : BigInt(0),
    }))
    .sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0))

  const holders = ranked.filter(u => u.balance > BigInt(0))
  const top10 = ranked.slice(0, 10)
  const top10Balance = top10.reduce((s, u) => s + u.balance, BigInt(0))
  const top10Pct = totalSupply > BigInt(0) ? ((Number(top10Balance) / Number(totalSupply)) * 100).toFixed(1) : '—'
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const newThisWeek = allUsers.filter(u => u.createdAt && new Date(u.createdAt) >= oneWeekAgo).length
  const maxBalance = ranked[0]?.balance ?? BigInt(1)

  return (
    <div className="min-h-screen">

      {/* ── Header ── */}
      <div className="border-b border-white/10 bg-zinc-950/50 px-8 py-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">nTZS Holders</h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              Base Mainnet ·{' '}
              <span className="font-mono text-xs text-zinc-600">{NTZS_ADDRESS.slice(0, 10)}…{NTZS_ADDRESS.slice(-6)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`${TOKEN_ADMIN}&action=pause`}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              Pause Token
            </Link>
            <Link
              href={`${TOKEN_ADMIN}&action=unpause`}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              Unpause Token
            </Link>
            <Link
              href={TOKEN_ADMIN}
              className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-400 hover:bg-violet-500/20 transition-colors"
            >
              Token Admin →
            </Link>
          </div>
        </div>
      </div>

      <div className="p-8 space-y-8">

        {/* ── Stats row ── */}
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-5">
            <p className="text-xs uppercase tracking-widest text-zinc-600 mb-1">Total Holders</p>
            <p className="text-3xl font-light text-white tabular-nums">{holders.length.toLocaleString()}</p>
            <p className="mt-1 text-xs text-zinc-600">{allUsers.length.toLocaleString()} registered accounts</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-5">
            <p className="text-xs uppercase tracking-widest text-zinc-600 mb-1">Circulating Supply</p>
            <p className="text-3xl font-light text-white tabular-nums">{fmt(totalSupply)}</p>
            <p className="mt-1 text-xs text-zinc-600">nTZS on Base mainnet</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-5">
            <p className="text-xs uppercase tracking-widest text-zinc-600 mb-1">Top-10 Concentration</p>
            <p className="text-3xl font-light text-white tabular-nums">{top10Pct}%</p>
            <p className="mt-1 text-xs text-zinc-600">of supply held by top 10</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-5">
            <p className="text-xs uppercase tracking-widest text-zinc-600 mb-1">New This Week</p>
            <p className="text-3xl font-light text-emerald-400 tabular-nums">+{newThisWeek}</p>
            <p className="mt-1 text-xs text-zinc-600">accounts registered</p>
          </div>
        </div>

        {/* ── Top 10 Holders ── */}
        <div className="rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden">
          <div className="border-b border-white/5 px-6 py-4">
            <h2 className="text-sm font-semibold text-white">Top Holders</h2>
            <p className="text-xs text-zinc-600 mt-0.5">Ranked by nTZS balance on Base mainnet</p>
          </div>
          <div className="divide-y divide-white/5">
            {top10.map((u, i) => {
              const rank = i + 1
              const barPct = maxBalance > BigInt(0) ? (Number(u.balance) / Number(maxBalance)) * 100 : 0
              const supplyPct = pct(u.balance, totalSupply)
              const label = u.email ?? u.phone ?? (u.walletAddress ? `${u.walletAddress.slice(0, 8)}…` : 'Unknown')
              return (
                <div key={u.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-white/[0.02] transition-colors">
                  <RankBadge rank={rank} />
                  <div className="w-40 shrink-0">
                    <p className="truncate text-xs text-white">{label}</p>
                    {u.partnerName && (
                      <span className="inline-flex items-center rounded-full border border-violet-500/25 bg-violet-500/10 px-1.5 py-px text-[9px] font-medium text-violet-400 mt-0.5">
                        {u.partnerName}
                      </span>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${rank === 1 ? 'bg-amber-400' : rank <= 3 ? 'bg-violet-400' : 'bg-zinc-500'}`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-xs text-zinc-500 tabular-nums">{supplyPct}%</span>
                    </div>
                  </div>
                  <div className="w-36 shrink-0 text-right">
                    <p className="font-mono text-sm text-white tabular-nums">{fmtFull(u.balance)}</p>
                    <p className="text-[10px] text-zinc-600">nTZS</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── All Holders Table ── */}
        <div className="rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden">
          <div className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">All Accounts</h2>
              <p className="text-xs text-zinc-600 mt-0.5">Sorted by balance · {allUsers.length} total</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <span className="rounded-full bg-purple-500/10 px-2.5 py-1 text-purple-400">{allUsers.filter(u => u.role === 'super_admin').length} admins</span>
              <span className="rounded-full bg-white/5 px-2.5 py-1">{allUsers.filter(u => u.role === 'end_user').length} end users</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-600 border-b border-white/5">
                  <th className="px-4 py-3 w-10">#</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Wallet</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">% Supply</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Joined</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {ranked.map((u, i) => (
                  <tr key={u.id} className="hover:bg-white/[0.015] transition-colors group">

                    {/* Rank */}
                    <td className="px-4 py-3.5">
                      <span className="text-xs text-zinc-600 tabular-nums">{i + 1}</span>
                    </td>

                    {/* User */}
                    <td className="px-4 py-3.5">
                      <p className="text-xs text-white font-medium leading-tight">
                        {u.email ?? u.phone ?? '—'}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-700 truncate max-w-[200px]">
                        {u.neonAuthUserId}
                      </p>
                    </td>

                    {/* Wallet */}
                    <td className="px-4 py-3.5">
                      {u.walletAddress ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] text-zinc-400">
                            {u.walletAddress.slice(0, 6)}…{u.walletAddress.slice(-4)}
                          </span>
                          <a
                            href={`https://basescan.org/address/${u.walletAddress}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-700 hover:text-zinc-400 transition-colors"
                            title="View on Basescan"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-700">No wallet</span>
                      )}
                    </td>

                    {/* Balance */}
                    <td className="px-4 py-3.5 text-right">
                      {u.walletAddress ? (
                        <span className={`font-mono text-xs tabular-nums ${u.balance > BigInt(0) ? 'text-white' : 'text-zinc-700'}`}>
                          {fmtFull(u.balance)}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-700">—</span>
                      )}
                    </td>

                    {/* % Supply */}
                    <td className="px-4 py-3.5 text-right">
                      {u.walletAddress && u.balance > BigInt(0) ? (
                        <span className="font-mono text-xs text-zinc-400 tabular-nums">
                          {pct(u.balance, totalSupply)}%
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-700">—</span>
                      )}
                    </td>

                    {/* Source */}
                    <td className="px-4 py-3.5">
                      {u.partnerName ? (
                        <span className="inline-flex items-center rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-400">
                          {u.partnerName}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800/50 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                          Direct
                        </span>
                      )}
                    </td>

                    {/* Role */}
                    <td className="px-4 py-3.5">
                      <RoleBadge role={u.role} />
                    </td>

                    {/* Joined */}
                    <td className="px-4 py-3.5 text-[11px] text-zinc-600 whitespace-nowrap">
                      {formatDateEAT(u.createdAt)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col gap-2">
                        {/* Token actions */}
                        {u.walletAddress && (
                          <div className="flex items-center gap-1">
                            <Link
                              href={`${TOKEN_ADMIN}&action=freeze&account=${encodeURIComponent(u.walletAddress)}`}
                              className="rounded px-2 py-1 text-[10px] font-medium text-zinc-400 bg-white/5 hover:bg-white/10 hover:text-white transition-colors"
                            >
                              Freeze
                            </Link>
                            <Link
                              href={`${TOKEN_ADMIN}&action=unfreeze&account=${encodeURIComponent(u.walletAddress)}`}
                              className="rounded px-2 py-1 text-[10px] font-medium text-zinc-400 bg-white/5 hover:bg-white/10 hover:text-white transition-colors"
                            >
                              Unfreeze
                            </Link>
                            <Link
                              href={`${TOKEN_ADMIN}&action=blacklist&account=${encodeURIComponent(u.walletAddress)}`}
                              className="rounded px-2 py-1 text-[10px] font-medium text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 transition-colors"
                            >
                              Blacklist
                            </Link>
                          </div>
                        )}
                        {/* Role */}
                        <form action={updateUserRoleAction} className="flex items-center gap-1">
                          <input type="hidden" name="userId" value={u.id} />
                          <select
                            name="role"
                            defaultValue={u.role}
                            className="rounded border border-white/8 bg-black/30 px-2 py-1 text-[10px] text-zinc-400 focus:outline-none focus:border-white/20"
                          >
                            <option value="end_user">End User</option>
                            <option value="bank_admin">Bank Admin</option>
                            <option value="platform_compliance">Compliance</option>
                            <option value="super_admin">Super Admin</option>
                          </select>
                          <SubmitButton
                            pendingText="…"
                            className="rounded bg-violet-500/10 px-2 py-1 text-[10px] font-medium text-violet-400 hover:bg-violet-500/20"
                          >
                            Set
                          </SubmitButton>
                        </form>
                      </div>
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
