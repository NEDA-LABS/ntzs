import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies } from '@/lib/merchant/auth'
import { withdrawMerchantFinancing } from '@/lib/merchant/financing'

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const result = await withdrawMerchantFinancing({
    merchantId: session.merchantId,
    amountTzs: Math.trunc(Number(body.amountTzs)),
    phone: typeof body.phone === 'string' ? body.phone.trim() : '',
  })
  return NextResponse.json(result.body, { status: result.status })
}
