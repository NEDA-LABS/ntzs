import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/merchant/db'
import { merchantAccounts } from '@ntzs/db'
import { requireServiceKey } from '@/lib/service-auth'

export async function GET(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) {
    return NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 })
  }

  const [account] = await db
    .select({
      id: merchantAccounts.id,
      email: merchantAccounts.email,
      businessName: merchantAccounts.businessName,
      handle: merchantAccounts.handle,
      walletAddress: merchantAccounts.walletAddress,
      settlePct: merchantAccounts.settlePct,
      settlementPendingTzs: merchantAccounts.settlementPendingTzs,
      isActive: merchantAccounts.isActive,
      onboardingStep: merchantAccounts.onboardingStep,
      userId: merchantAccounts.userId,
      createdAt: merchantAccounts.createdAt,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ account })
}

export async function PATCH(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) {
    return NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 })
  }

  const body = await req.json()
  const businessName = typeof body.businessName === 'string' ? body.businessName.trim() : undefined

  if (!businessName) {
    return NextResponse.json({ error: 'businessName required' }, { status: 400 })
  }

  await db
    .update(merchantAccounts)
    .set({ businessName, updatedAt: new Date() })
    .where(eq(merchantAccounts.id, merchantId))

  return NextResponse.json({ ok: true })
}
