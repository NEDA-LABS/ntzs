import { NextRequest, NextResponse } from 'next/server'

import { getSessionFromCookies } from '@/lib/merchant/auth'
import { requestMerchantWithdrawal } from '@/lib/merchant/withdraw'

/**
 * POST /merchant/api/merchant/withdraw
 * Explicit cash-out of the merchant's own nTZS wallet balance to mobile money.
 * Body: { amountTzs: number (net you receive, min 5,000), phone?: string }
 * (phone defaults to the saved settlement/payout phone).
 */
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { amountTzs?: number; phone?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await requestMerchantWithdrawal({
    merchantId: session.merchantId,
    receiveAmountTzs: Number(body.amountTzs),
    phone: body.phone ?? null,
  })
  return NextResponse.json(result.body, { status: result.status })
}
