import { NextResponse } from 'next/server'
import { getSessionFromCookies } from '@/lib/fx/auth'
import { db } from '@/lib/fx/db'
import { lpAccounts, lpWalletTransactions } from '@ntzs/db'
import { eq, desc } from 'drizzle-orm'
import { syncLpWalletTransactions } from '@/lib/fx/syncWalletTransactions'

export async function GET() {
  try {
    const session = await getSessionFromCookies()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Fetch LP wallet address so we can sync on-chain transfers
    const [lp] = await db
      .select({ walletAddress: lpAccounts.walletAddress })
      .from(lpAccounts)
      .where(eq(lpAccounts.id, session.lpId))
      .limit(1)

    // Kick off on-chain sync in the background — don't await so it never blocks the response
    if (lp) {
      void syncLpWalletTransactions(session.lpId, lp.walletAddress)
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
