import { NextRequest, NextResponse } from 'next/server'
import { and, eq, desc, lt, sql } from 'drizzle-orm'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { wallets, lpFills } from '@ntzs/db'
import { SWAP_TOKENS } from '@/lib/fx/swap'

const PAGE_SIZE = 20

/** Paginated swap history for the authenticated user. */
export async function GET(request: NextRequest) {
  let dbUser: Awaited<ReturnType<typeof requireAnyRole>>
  try {
    dbUser = await requireAnyRole(['end_user', 'super_admin'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { db } = getDb()

  // Get the user's platform HD wallet address
  const [wallet] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, dbUser.id), eq(wallets.provider, 'platform_hd')))
    .limit(1)

  if (!wallet) {
    return NextResponse.json({ swaps: [], hasMore: false })
  }

  const userAddress = wallet.address.toLowerCase()

  // Cursor-based pagination: pass ?cursor=<createdAt ISO string> for next page
  const cursorParam = request.nextUrl.searchParams.get('cursor')
  const cursor = cursorParam ? new Date(cursorParam) : null

  const conditions = [sql`lower(${lpFills.userAddress}) = ${userAddress}`]
  if (cursor) {
    conditions.push(lt(lpFills.createdAt, cursor))
  }

  const fills = await db
    .select({
      id: lpFills.id,
      fromToken: lpFills.fromToken,
      toToken: lpFills.toToken,
      amountIn: lpFills.amountIn,
      amountOut: lpFills.amountOut,
      inTxHash: lpFills.inTxHash,
      outTxHash: lpFills.outTxHash,
      createdAt: lpFills.createdAt,
    })
    .from(lpFills)
    .where(and(...conditions))
    .orderBy(desc(lpFills.createdAt))
    .limit(PAGE_SIZE + 1)

  const hasMore = fills.length > PAGE_SIZE
  const page = hasMore ? fills.slice(0, PAGE_SIZE) : fills

  // Resolve token symbols from contract addresses
  const addrToSymbol: Record<string, string> = {}
  for (const [sym, info] of Object.entries(SWAP_TOKENS)) {
    addrToSymbol[info.address.toLowerCase()] = sym
  }

  const swaps = page.map((f) => ({
    id: f.id,
    fromSymbol: addrToSymbol[f.fromToken.toLowerCase()] ?? f.fromToken,
    toSymbol: addrToSymbol[f.toToken.toLowerCase()] ?? f.toToken,
    amountIn: f.amountIn,
    amountOut: f.amountOut,
    inTxHash: f.inTxHash,
    outTxHash: f.outTxHash,
    createdAt: f.createdAt.toISOString(),
  }))

  const nextCursor = hasMore ? page[page.length - 1].createdAt.toISOString() : null

  return NextResponse.json({ swaps, hasMore, nextCursor })
}
