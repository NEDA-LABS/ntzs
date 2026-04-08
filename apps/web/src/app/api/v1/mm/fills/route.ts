import { NextRequest, NextResponse } from 'next/server'
import { authenticateMM } from '@/lib/fx/auth'
import { getDb } from '@/lib/db'
import { lpFills } from '@ntzs/db'
import { eq, desc } from 'drizzle-orm'

export async function GET(request: NextRequest) {
  const authResult = await authenticateMM(request)
  if ('error' in authResult) return authResult.error

  const { mm } = authResult
  const { db } = getDb()

  const fills = await db
    .select()
    .from(lpFills)
    .where(eq(lpFills.lpId, mm.lpId))
    .orderBy(desc(lpFills.createdAt))
    .limit(100)

  return NextResponse.json({ fills })
}
