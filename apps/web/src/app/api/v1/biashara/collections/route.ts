import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from '@/lib/merchant/db'
import { merchantCollections } from '@ntzs/db'
import { requireServiceKey } from '@/lib/service-auth'

export async function GET(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) {
    return NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 })
  }

  const { searchParams } = req.nextUrl
  const cursor = searchParams.get('cursor')
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 50)

  const conditions = [eq(merchantCollections.merchantId, merchantId)]
  if (cursor) conditions.push(lt(merchantCollections.createdAt, new Date(cursor)))

  const rows = await db
    .select()
    .from(merchantCollections)
    .where(and(...conditions))
    .orderBy(desc(merchantCollections.createdAt))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null

  return NextResponse.json({ items, nextCursor })
}
