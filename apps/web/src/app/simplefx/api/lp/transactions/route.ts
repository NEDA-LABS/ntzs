import { NextResponse } from 'next/server'
import { getSessionFromCookies } from '@/lib/fx/auth'
import { db } from '@/lib/fx/db'
import { lpAccounts, lpWalletTransactions, lpFxPairs } from '@ntzs/db'
import { eq, desc } from 'drizzle-orm'
import { syncLpWalletTransactions } from '@/lib/fx/syncWalletTransactions'
import type { ChainId } from '@/lib/fx/chainConfig'

export async function GET() {
  try {
    const session = await getSessionFromCookies()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [[lp], activePairs] = await Promise.all([
      db
        .select({ walletAddress: lpAccounts.walletAddress })
        .from(lpAccounts)
        .where(eq(lpAccounts.id, session.lpId))
        .limit(1),
      db.select({ chain: lpFxPairs.chain }).from(lpFxPairs).where(eq(lpFxPairs.isActive, true)),
    ])

    // Sync on-chain transfers for every active chain — fire-and-forget
    if (lp) {
      const chains = [...new Set(activePairs.map((p) => (p.chain ?? 'base') as ChainId))]
      for (const chain of chains) {
        void syncLpWalletTransactions(session.lpId, lp.walletAddress, chain)
      }
    }

    const transactions = await db
      .select()
      .from(lpWalletTransactions)
      .where(eq(lpWalletTransactions.lpId, session.lpId))
      .orderBy(desc(lpWalletTransactions.createdAt))
      .limit(200)

    return NextResponse.json({ transactions })
  } catch (err) {
    console.error('[transactions]', err)
    return NextResponse.json({ transactions: [] })
  }
}
