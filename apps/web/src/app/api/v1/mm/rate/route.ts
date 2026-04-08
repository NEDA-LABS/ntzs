import { NextRequest, NextResponse } from 'next/server'
import { authenticateMM } from '@/lib/fx/auth'
import { getDb } from '@/lib/db'
import { lpFxConfig } from '@ntzs/db'
import { eq } from 'drizzle-orm'

export async function GET(request: NextRequest) {
  const authResult = await authenticateMM(request)
  if ('error' in authResult) return authResult.error

  const { db } = getDb()
  const [config] = await db.select().from(lpFxConfig).where(eq(lpFxConfig.id, 1)).limit(1)

  return NextResponse.json({ midRateTZS: config?.midRateTZS ?? 3750 })
}
