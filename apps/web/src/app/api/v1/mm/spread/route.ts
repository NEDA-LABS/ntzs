import { NextRequest, NextResponse } from 'next/server'
import { authenticateMM } from '@/lib/fx/auth'
import { getDb } from '@/lib/db'
import { lpAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'

export async function PATCH(request: NextRequest) {
  const authResult = await authenticateMM(request)
  if ('error' in authResult) return authResult.error

  const { mm } = authResult

  let body: { bidBps: number; askBps: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { bidBps, askBps } = body

  if (
    typeof bidBps !== 'number' || typeof askBps !== 'number' ||
    bidBps < 10 || bidBps > 500 || askBps < 10 || askBps > 500
  ) {
    return NextResponse.json({ error: 'Invalid spread values (10–500 bps each)' }, { status: 400 })
  }

  const { db } = getDb()
  const [updated] = await db
    .update(lpAccounts)
    .set({ bidBps, askBps, updatedAt: new Date() })
    .where(eq(lpAccounts.id, mm.lpId))
    .returning({ bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps, updatedAt: lpAccounts.updatedAt })

  return NextResponse.json({ bidBps: updated.bidBps, askBps: updated.askBps, updatedAt: updated.updatedAt })
}
