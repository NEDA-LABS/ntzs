import { NextRequest, NextResponse } from 'next/server'
import { requireBiasharaMerchant } from '@/lib/biashara/caller'
import { withdrawMerchantFinancing } from '@/lib/merchant/financing'

/**
 * POST /api/v1/biashara/financing/withdraw  (NEDApay service layer)
 * Off-ramp the merchant's financing to mobile money. Body: { amountTzs, phone }.
 * Headers: x-service-key, x-merchant-id. Shares the exact money logic with the
 * in-app merchant route via withdrawMerchantFinancing().
 */
export async function POST(req: NextRequest) {
  const authResult = await requireBiasharaMerchant(req)
  if ('error' in authResult) return authResult.error
  const { merchantId } = authResult

  const body = await req.json().catch(() => ({}))
  const result = await withdrawMerchantFinancing({
    merchantId,
    amountTzs: Math.trunc(Number(body.amountTzs)),
    phone: typeof body.phone === 'string' ? body.phone.trim() : '',
  })
  return NextResponse.json(result.body, { status: result.status })
}
