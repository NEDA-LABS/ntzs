import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from '@/lib/merchant/db'
import { merchantCollections } from '@ntzs/db'
import { requireBiasharaMerchant } from '@/lib/biashara/caller'

export async function GET(req: NextRequest) {
  const authResult = await requireBiasharaMerchant(req)
  if ('error' in authResult) return authResult.error
  const { merchantId } = authResult

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
