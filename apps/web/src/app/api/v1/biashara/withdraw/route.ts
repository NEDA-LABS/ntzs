import { NextRequest, NextResponse } from 'next/server'

import { requireServiceKey } from '@/lib/service-auth'
import { requestMerchantWithdrawal } from '@/lib/merchant/withdraw'

/**
 * POST /api/v1/biashara/withdraw  (NEDApay service layer)
 * Explicit cash-out of the merchant's own nTZS wallet balance to mobile money —
 * the Withdraw button. Body: { amountTzs: number (net the merchant receives,
 * min 5,000), phone?: string } (phone defaults to the saved payout phone).
 * Headers: x-service-key, x-merchant-id.
 *
 * Distinct from /financing/withdraw (lender-facility draw): this burns the
 * merchant's own balance and needs no lender.
 */
export async function POST(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) return NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 })

  let body: { amountTzs?: number; phone?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await requestMerchantWithdrawal({
    merchantId,
    receiveAmountTzs: Number(body.amountTzs),
    phone: body.phone ?? null,
  })
  return NextResponse.json(result.body, { status: result.status })
}
