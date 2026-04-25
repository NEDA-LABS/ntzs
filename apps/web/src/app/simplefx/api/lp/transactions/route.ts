import { NextResponse } from 'next/server'
import { getSessionFromCookies } from '@/lib/fx/auth'
import { db } from '@/lib/fx/db'
import { lpWalletTransactions } from '@ntzs/db'
import { eq, desc } from 'drizzle-orm'

export async function GET() {
  try {
    const session = await getSessionFromCookies()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
