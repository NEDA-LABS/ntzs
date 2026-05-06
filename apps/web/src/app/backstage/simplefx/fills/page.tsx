import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { lpFills, lpAccounts, partners } from '@ntzs/db'
import { formatDateEAT } from '@/lib/format-date'

const TOKEN_SYMBOLS: Record<string, string> = {
  '0xf476ba983de2f1ad532380630e2cf1d1b8b10688': 'nTZS',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
  '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': 'USDT',
}

function tokenSymbol(addr: string | null) {
  if (!addr) return '—'
  return TOKEN_SYMBOLS[addr.toLowerCase()] ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function shortHash(hash: string | null) {
  if (!hash) return '—'
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

function SourceBadge({ source, partnerName }: { source: string | null; partnerName: string | null }) {
  if (source === 'waas') {
    return (
      <span className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-violet-400">
        {partnerName ?? 'WaaS'}
      </span>
    )
  }
  if (source === 'app') {
    return (
      <span className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-blue-400">
        App
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-500">
      —
    </span>
  )
}

export default async function SwapFillsPage() {
  await requireAnyRole(['super_admin'])
  const { db } = getDb()

  const fills = await db
    .select({
      id: lpFills.id,
      createdAt: lpFills.createdAt,
      source: lpFills.source,
      userAddress: lpFills.userAddress,
      fromToken: lpFills.fromToken,
      toToken: lpFills.toToken,
      amountIn: lpFills.amountIn,
      amountOut: lpFills.amountOut,
      spreadEarned: lpFills.spreadEarned,
      inTxHash: lpFills.inTxHash,
      outTxHash: lpFills.outTxHash,
      lpId: lpFills.lpId,
      lpEmail: lpAccounts.email,
      lpDisplayName: lpAccounts.displayName,
      partnerName: partners.name,
    })
    .from(lpFills)
    .leftJoin(lpAccounts, eq(lpFills.lpId, lpAccounts.id))
    .leftJoin(partners, eq(lpFills.partnerId, partners.id))
    .orderBy(desc(lpFills.createdAt))
    .limit(500)

  const totalSpread = fills.reduce(
    (sum, f) => sum + parseFloat(f.spreadEarned?.toString() ?? '0'),
    0,
  )
  const waasCount = fills.filter((f) => f.source === 'waas').length
  const appCount  = fills.filter((f) => f.source === 'app').length

  return (
    <div className="min-h-screen">
      <div className="border-b border-white/10 bg-zinc-950/50 px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/backstage/simplefx" className="text-zinc-500 hover:text-white transition-colors text-sm">
              ← SimpleFX
            </Link>
            <span className="text-zinc-700">/</span>
            <div>
              <h1 className="text-2xl font-bold text-white">Swap History</h1>
              <p className="mt-0.5 text-sm text-zinc-400">All LP fills — app + WaaS, most recent first</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="rounded-full bg-white/5 px-3 py-1 text-sm text-zinc-400">{fills.length} fills</span>
            <span className="rounded-full bg-blue-500/10 px-3 py-1 text-sm text-blue-400">{appCount} app</span>
            <span className="rounded-full bg-violet-500/10 px-3 py-1 text-sm text-violet-400">{waasCount} WaaS</span>
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-sm text-emerald-400">
              {totalSpread.toLocaleString(undefined, { maximumFractionDigits: 4 })} spread
            </span>
            <a
              href="/api/backstage/simplefx/fills-export"
              className="rounded-xl bg-white/5 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              Export CSV ↓
            </a>
          </div>
        </div>
      </div>

      <div className="p-8">
        {fills.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-zinc-950 px-6 py-20 text-center text-zinc-600">
            No swap fills recorded yet.
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-zinc-600 border-b border-white/5">
                    <th className="px-5 py-3">Timestamp (EAT)</th>
                    <th className="px-5 py-3">Source</th>
                    <th className="px-5 py-3">LP</th>
                    <th className="px-5 py-3">User wallet</th>
                    <th className="px-5 py-3">Pair</th>
                    <th className="px-5 py-3">Amount in</th>
                    <th className="px-5 py-3">Amount out</th>
                    <th className="px-5 py-3">Spread earned</th>
                    <th className="px-5 py-3">In tx</th>
                    <th className="px-5 py-3">Out tx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {fills.map((f) => (
                    <tr key={f.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-3.5 text-xs text-zinc-400 whitespace-nowrap tabular-nums">
                        {formatDateEAT(f.createdAt)}
                      </td>
                      <td className="px-5 py-3.5">
                        <SourceBadge source={f.source} partnerName={f.partnerName ?? null} />
                      </td>
                      <td className="px-5 py-3.5">
                        {f.lpId ? (
                          <Link
                            href={`/backstage/simplefx/${f.lpId}`}
                            className="text-blue-400 hover:text-blue-300 transition-colors text-xs"
                          >
                            {f.lpDisplayName ?? f.lpEmail ?? f.lpId.slice(0, 8)}
                          </Link>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-zinc-400">
                        {f.userAddress
                          ? `${f.userAddress.slice(0, 6)}…${f.userAddress.slice(-4)}`
                          : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-zinc-300 whitespace-nowrap">
                        {tokenSymbol(f.fromToken)} → {tokenSymbol(f.toToken)}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-zinc-300 tabular-nums">
                        {parseFloat(f.amountIn?.toString() ?? '0').toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-zinc-300 tabular-nums">
                        {parseFloat(f.amountOut?.toString() ?? '0').toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-emerald-400 tabular-nums">
                        {parseFloat(f.spreadEarned?.toString() ?? '0').toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs">
                        {f.inTxHash ? (
                          <a
                            href={`https://basescan.org/tx/${f.inTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-400 hover:text-white transition-colors"
                            title={f.inTxHash}
                          >
                            {shortHash(f.inTxHash)}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs">
                        {f.outTxHash ? (
                          <a
                            href={`https://basescan.org/tx/${f.outTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-400 hover:text-white transition-colors"
                            title={f.outTxHash}
                          >
                            {shortHash(f.outTxHash)}
                          </a>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
