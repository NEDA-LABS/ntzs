import { eq, desc } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { JsonRpcProvider, Contract, formatUnits } from 'ethers'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { lpAccounts, lpPoolPositions, lpFills } from '@ntzs/db'
import { SubmitButton } from '../../_components/SubmitButton'
import { formatDateEAT } from '@/lib/format-date'

const TOKENS = {
  nTZS:  { address: '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688', decimals: 18, symbol: 'nTZS'  },
  USDC:  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6,  symbol: 'USDC'  },
}
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

async function toggleLpActiveAction(formData: FormData) {
  'use server'
  await requireAnyRole(['super_admin'])
  const id = String(formData.get('id') ?? '')
  const isActive = formData.get('isActive') === 'true'
  if (!id) throw new Error('Missing id')
  const { db } = getDb()
  await db.update(lpAccounts).set({ isActive: !isActive, updatedAt: new Date() }).where(eq(lpAccounts.id, id))
  revalidatePath(`/backstage/simplefx/${id}`)
  revalidatePath('/backstage/simplefx')
}

async function setKycAction(formData: FormData) {
  'use server'
  await requireAnyRole(['super_admin'])
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '') as 'approved' | 'rejected' | 'pending'
  if (!id || !['approved', 'rejected', 'pending'].includes(status)) throw new Error('Invalid params')
  const { db } = getDb()
  await db.update(lpAccounts).set({ kycStatus: status, updatedAt: new Date() }).where(eq(lpAccounts.id, id))
  revalidatePath(`/backstage/simplefx/${id}`)
  revalidatePath('/backstage/simplefx')
}

function KycBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    approved: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    rejected: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${styles[status] ?? styles.pending}`}>
      {status}
    </span>
  )
}

export default async function LpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { db } = getDb()

  const [lp] = await db.select().from(lpAccounts).where(eq(lpAccounts.id, id)).limit(1)
  if (!lp) notFound()

  // Fetch pool positions and recent fills
  const [positions, recentFills] = await Promise.all([
    db.select().from(lpPoolPositions).where(eq(lpPoolPositions.lpId, id)),
    db
      .select()
      .from(lpFills)
      .where(eq(lpFills.lpId, id))
      .orderBy(desc(lpFills.createdAt))
      .limit(20),
  ])

  const totalSpreadEarned = recentFills.reduce((sum, f) => sum + parseFloat(f.spreadEarned?.toString() ?? '0'), 0)
  const totalFills = recentFills.length

  // Fetch on-chain balances (Base mainnet)
  let balances: Record<string, string> = {}
  try {
    const rpcUrl = process.env.BASE_RPC_URL
    if (rpcUrl) {
      const provider = new JsonRpcProvider(rpcUrl)
      const results = await Promise.all(
        Object.entries(TOKENS).map(async ([key, token]) => {
          const contract = new Contract(token.address, ERC20_ABI, provider)
          const raw: bigint = await contract.balanceOf(lp.walletAddress)
          return [key, parseFloat(formatUnits(raw, token.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })]
        })
      )
      balances = Object.fromEntries(results)
    }
  } catch {
    // Non-fatal — show dashes if RPC fails
  }

  const bidPct  = (lp.bidBps  / 100).toFixed(2)
  const askPct  = (lp.askBps  / 100).toFixed(2)

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-white/10 bg-zinc-950/50 px-8 py-6">
        <div className="flex items-center gap-4">
          <Link href="/backstage/simplefx" className="text-zinc-500 hover:text-white transition-colors text-sm">
            ← SimpleFX
          </Link>
          <span className="text-zinc-700">/</span>
          <h1 className="text-xl font-bold text-white">{lp.email}</h1>
          <KycBadge status={lp.kycStatus} />
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            lp.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-500/10 text-zinc-500'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${lp.isActive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
            {lp.isActive ? 'Live' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">
        {/* Left column: info + actions */}
        <div className="space-y-6">
          {/* Profile */}
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Profile</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-zinc-600 mb-0.5">Email</dt>
                <dd className="text-white">{lp.email}</dd>
              </div>
              {lp.displayName && (
                <div>
                  <dt className="text-xs text-zinc-600 mb-0.5">Display name</dt>
                  <dd className="text-white">{lp.displayName}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-zinc-600 mb-0.5">Wallet address</dt>
                <dd className="font-mono text-xs text-zinc-300 break-all">{lp.walletAddress}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-600 mb-0.5">Wallet index</dt>
                <dd className="font-mono text-zinc-400">{lp.walletIndex}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-600 mb-0.5">Onboarding step</dt>
                <dd className="text-zinc-400">{lp.onboardingStep}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-600 mb-0.5">Joined</dt>
                <dd className="text-zinc-400">{formatDateEAT(lp.createdAt)}</dd>
              </div>
            </dl>
          </div>

          {/* KYC Actions */}
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">KYC</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <form action={setKycAction}>
                <input type="hidden" name="id" value={lp.id} />
                <input type="hidden" name="status" value="approved" />
                <SubmitButton
                  pendingText="Approving..."
                  className="rounded-xl bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
                >
                  Approve KYC
                </SubmitButton>
              </form>
              <form action={setKycAction}>
                <input type="hidden" name="id" value={lp.id} />
                <input type="hidden" name="status" value="rejected" />
                <SubmitButton
                  pendingText="Rejecting..."
                  className="rounded-xl bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-400 hover:bg-rose-500/20"
                >
                  Reject KYC
                </SubmitButton>
              </form>
              <form action={setKycAction}>
                <input type="hidden" name="id" value={lp.id} />
                <input type="hidden" name="status" value="pending" />
                <SubmitButton
                  pendingText="..."
                  className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-700"
                >
                  Reset to Pending
                </SubmitButton>
              </form>
            </div>
          </div>

          {/* Activate / Deactivate */}
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Position</h2>
            <p className="text-xs text-zinc-500">
              {lp.isActive
                ? 'This LP is currently live and filling orders.'
                : 'This LP is inactive. Activate to allow order fills.'}
            </p>
            <form action={toggleLpActiveAction}>
              <input type="hidden" name="id" value={lp.id} />
              <input type="hidden" name="isActive" value={String(lp.isActive)} />
              <SubmitButton
                pendingText="..."
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  lp.isActive
                    ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    : 'bg-blue-600 text-white hover:bg-blue-500'
                }`}
              >
                {lp.isActive ? 'Deactivate' : 'Activate'}
              </SubmitButton>
            </form>
          </div>
        </div>

        {/* Right column: balances + spread */}
        <div className="lg:col-span-2 space-y-6">
          {/* On-chain Balances */}
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">On-chain Inventory (Base)</h2>
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(TOKENS).map(([key, token]) => (
                <div key={key} className="rounded-xl bg-black/40 border border-white/5 p-4">
                  <p className="text-xs text-zinc-500 mb-1">{token.symbol}</p>
                  <p className="text-2xl font-light text-white tabular-nums">
                    {balances[key] ?? '—'}
                  </p>
                  <p className="mt-1 text-xs font-mono text-zinc-700 truncate">{token.address.slice(0, 10)}…</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-zinc-700">
              Wallet: <span className="font-mono">{lp.walletAddress}</span>
            </p>
          </div>

          {/* Spread Configuration */}
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">Spread Configuration</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-black/40 border border-white/5 p-4">
                <p className="text-xs text-zinc-500 mb-1">Bid spread (LP buys nTZS)</p>
                <p className="text-2xl font-light text-indigo-400 tabular-nums">{bidPct}%</p>
                <p className="text-xs text-zinc-600 mt-0.5">{lp.bidBps} bps</p>
              </div>
              <div className="rounded-xl bg-black/40 border border-white/5 p-4">
                <p className="text-xs text-zinc-500 mb-1">Ask spread (LP sells nTZS)</p>
                <p className="text-2xl font-light text-blue-400 tabular-nums">{askPct}%</p>
                <p className="text-xs text-zinc-600 mt-0.5">{lp.askBps} bps</p>
              </div>
            </div>
          </div>

          {/* Pool Positions */}
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">Live Positions</h2>
            {positions.length === 0 ? (
              <p className="text-sm text-zinc-600">No pool positions yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {positions.map((pos) => {
                  const contributed = parseFloat(pos.contributed?.toString() ?? '0')
                  const earned = parseFloat(pos.earned?.toString() ?? '0')
                  return (
                    <div key={pos.id} className="rounded-xl bg-black/40 border border-white/5 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-white">{pos.tokenSymbol}</span>
                        <span className="text-xs font-mono text-zinc-600">{pos.tokenAddress.slice(0, 10)}…</span>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500 mb-0.5">Contributed</p>
                        <p className="text-lg font-light text-white tabular-nums">
                          {contributed.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500 mb-0.5">Spread Earned</p>
                        <p className={`text-lg font-light tabular-nums ${earned > 0 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                          {earned > 0 ? '+' : ''}{earned.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recent Fills */}
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Recent Fills</h2>
              <div className="flex items-center gap-4 text-xs text-zinc-500">
                <span>{totalFills} fill{totalFills !== 1 ? 's' : ''}</span>
                {totalSpreadEarned > 0 && (
                  <span className="text-emerald-400">+{totalSpreadEarned.toFixed(6)} spread earned</span>
                )}
              </div>
            </div>
            {recentFills.length === 0 ? (
              <p className="text-sm text-zinc-600">No fills recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-xs text-zinc-600">
                      <th className="pb-2 text-left font-medium">Time</th>
                      <th className="pb-2 text-left font-medium">Direction</th>
                      <th className="pb-2 text-right font-medium">In</th>
                      <th className="pb-2 text-right font-medium">Out</th>
                      <th className="pb-2 text-right font-medium">Spread</th>
                      <th className="pb-2 text-left font-medium">Tx</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {recentFills.map((fill) => {
                      const fromSym = fill.fromToken.toLowerCase().includes('f476') ? 'nTZS' : 'USDC'
                      const toSym = fill.toToken.toLowerCase().includes('f476') ? 'nTZS' : 'USDC'
                      const spread = parseFloat(fill.spreadEarned?.toString() ?? '0')
                      return (
                        <tr key={fill.id} className="text-zinc-400 hover:bg-white/[0.02] transition-colors">
                          <td className="py-2.5 text-xs text-zinc-500 whitespace-nowrap">
                            {formatDateEAT(fill.createdAt)}
                          </td>
                          <td className="py-2.5">
                            <span className="inline-flex items-center gap-1 text-xs">
                              <span className={fromSym === 'USDC' ? 'text-blue-400' : 'text-violet-400'}>{fromSym}</span>
                              <span className="text-zinc-600">→</span>
                              <span className={toSym === 'USDC' ? 'text-blue-400' : 'text-violet-400'}>{toSym}</span>
                            </span>
                          </td>
                          <td className="py-2.5 text-right font-mono text-xs tabular-nums">
                            {parseFloat(fill.amountIn?.toString() ?? '0').toLocaleString(undefined, { maximumFractionDigits: 4 })}
                          </td>
                          <td className="py-2.5 text-right font-mono text-xs tabular-nums">
                            {parseFloat(fill.amountOut?.toString() ?? '0').toLocaleString(undefined, { maximumFractionDigits: 4 })}
                          </td>
                          <td className={`py-2.5 text-right font-mono text-xs tabular-nums ${spread > 0 ? 'text-emerald-400' : 'text-zinc-600'}`}>
                            {spread > 0 ? `+${spread.toFixed(6)}` : '0'}
                          </td>
                          <td className="py-2.5">
                            <a
                              href={`https://basescan.org/tx/${fill.outTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-zinc-600 hover:text-blue-400 transition-colors"
                            >
                              {fill.outTxHash.slice(0, 8)}…
                            </a>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
