import { NextResponse } from 'next/server'
import { getSessionFromCookies } from '@/lib/fx/auth'
import { db } from '@/lib/fx/db'
import { lpFills } from '@ntzs/db'
import { eq, desc } from 'drizzle-orm'

export async function GET() {
  try {
    const session = await getSessionFromCookies()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const fills = await db
      .select()
      .from(lpFills)
      .where(eq(lpFills.lpId, session.lpId))
      .orderBy(desc(lpFills.createdAt))
      .limit(100)

    return NextResponse.json({ fills })
  } catch (err) {
    console.error('[fills]', err)
    return NextResponse.json({ fills: [] })
  }
}
