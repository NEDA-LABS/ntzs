import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/merchant/auth';
import { db } from '@/lib/merchant/db';
import { merchantCollections } from '@ntzs/db';
import { and, desc, eq, lt } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 50);

  const conditions = [eq(merchantCollections.merchantId, session.merchantId)];
  if (cursor) conditions.push(lt(merchantCollections.createdAt, new Date(cursor)));

  const rows = await db
    .select()
    .from(merchantCollections)
    .where(and(...conditions))
    .orderBy(desc(merchantCollections.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

  return NextResponse.json({ items, nextCursor });
}
