import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { depositRequests } from '@ntzs/db'

export async function GET(request: NextRequest) {
  const depositId = request.nextUrl.searchParams.get('id')

  if (!depositId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const { db } = getDb()

  const [deposit] = await db
    .select({
      id: depositRequests.id,
      status: depositRequests.status,
      amountTzs: depositRequests.amountTzs,
    })
    .from(depositRequests)
    .where(eq(depositRequests.id, depositId))
    .limit(1)

  if (!deposit) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Map internal statuses to simple payer-facing states
  let payerStatus: 'pending' | 'processing' | 'success' | 'failed'

  switch (deposit.status) {
    case 'submitted':
      payerStatus = 'pending'
      break
    case 'mint_pending':
    case 'mint_processing':
    case 'mint_requires_safe':
    case 'fiat_confirmed':
    case 'bank_approved':
    case 'platform_approved':
    case 'kyc_approved':
    case 'awaiting_fiat':
      payerStatus = 'processing'
      break
    case 'minted':
      payerStatus = 'success'
      break
    default:
      payerStatus = 'failed'
  }

  return NextResponse.json({
    id: deposit.id,
    status: payerStatus,
    amountTzs: deposit.amountTzs,
  })
}
