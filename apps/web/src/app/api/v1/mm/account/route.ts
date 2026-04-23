import { NextRequest, NextResponse } from 'next/server'
import { authenticateMM } from '@/lib/fx/auth'
import { getDb } from '@/lib/db'
import { lpAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'

export async function GET(request: NextRequest) {
  const authResult = await authenticateMM(request)
  if ('error' in authResult) return authResult.error

  const { mm } = authResult
  const { db } = getDb()

  const [lp] = await db
    .select({
      id: lpAccounts.id,
      email: lpAccounts.email,
      displayName: lpAccounts.displayName,
      walletAddress: lpAccounts.walletAddress,
      isActive: lpAccounts.isActive,
      kycStatus: lpAccounts.kycStatus,
      createdAt: lpAccounts.createdAt,
    })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, mm.lpId))
    .limit(1)

  if (!lp) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  return NextResponse.json({ account: lp })
}
