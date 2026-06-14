import { NextRequest, NextResponse } from 'next/server'
import { requireServiceKey } from '@/lib/service-auth'
import { withdrawMerchantFinancing } from '@/lib/merchant/financing'

/**
 * POST /api/v1/biashara/financing/withdraw  (NEDApay service layer)
 * Off-ramp the merchant's financing to mobile money. Body: { amountTzs, phone }.
 * Headers: x-service-key, x-merchant-id. Shares the exact money logic with the
 * in-app merchant route via withdrawMerchantFinancing().
 */
export async function POST(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) return NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const result = await withdrawMerchantFinancing({
    merchantId,
    amountTzs: Math.trunc(Number(body.amountTzs)),
    phone: typeof body.phone === 'string' ? body.phone.trim() : '',
  })
  return NextResponse.json(result.body, { status: result.status })
}
