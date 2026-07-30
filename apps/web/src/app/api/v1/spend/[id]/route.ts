import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { isTestMode, testGetSpend } from '@/lib/testmode'
import { authenticatePartner } from '@/lib/waas/auth'
import { burnRequests } from '@ntzs/db'

/**
 * GET /api/v1/spend/:id — status and settlement of a spend, INCLUDING the
 * utility voucher once Selcom reports it.
 *
 * ⚠ WHY THIS ROUTE EXISTS. On 30 July 2026 a LUKU purchase succeeded while the
 * client's request died in transport. The customer saw "Payment failed", the
 * token existed only in our own operator SMS, and there was no API to fetch it
 * afterwards — POST /api/v1/spend was the only surface, and calling it again
 * pays again. A settlement whose product cannot be retrieved is not settled
 * from the customer's point of view.
 *
 * Poll this after any ambiguous POST outcome instead of retrying the POST.
 * The 409 duplicate-guard response carries the same fields for the
 * already-paid case.
 *
 * Tenancy: the spend descriptor's own partnerId is the authority — spends can
 * fund from agent-float sub-wallets, where the partner_users mapping used by
 * the withdrawal route does not apply. 404 (not 403) on a foreign id, per the
 * platform rule of not confirming another tenant's resources exist.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error
  const { partner } = authResult
  const { id } = await params

  if (isTestMode(partner)) return testGetSpend(partner, id)

  const { db } = getDb()
  const [burn] = await db
    .select({
      id: burnRequests.id,
      status: burnRequests.status,
      amountTzs: burnRequests.amountTzs,
      payoutStatus: burnRequests.payoutStatus,
      payoutError: burnRequests.payoutError,
      payoutReference: burnRequests.payoutReference,
      payoutKind: burnRequests.payoutKind,
      spend: burnRequests.spend,
      createdAt: burnRequests.createdAt,
    })
    .from(burnRequests)
    .where(eq(burnRequests.id, id))
    .limit(1)

  const spend = (burn?.spend ?? null) as Record<string, unknown> | null

  // A spend row is identified by its descriptor; a burn without one (plain
  // withdrawal) is not addressable here.
  if (!burn || !spend || spend.partnerId !== partner.id) {
    return NextResponse.json({ error: 'Spend not found' }, { status: 404 })
  }

  const str = (k: string) => (typeof spend[k] === 'string' ? (spend[k] as string) : null)
  const num = (k: string) => (typeof spend[k] === 'number' ? (spend[k] as number) : null)

  return NextResponse.json({
    id: burn.id,
    status: burn.status,
    payoutStatus: burn.payoutStatus ?? null,
    payoutError: burn.payoutError ?? null,
    reference: burn.payoutReference ?? null,
    kind: str('kind') ?? burn.payoutKind ?? null,
    target:
      spend.kind === 'lipa'
        ? { payNumber: str('payNumber'), network: str('network') }
        : { utilityCode: str('utilityCode'), utilityRef: str('utilityRef') },
    recipientName: str('recipientName'),
    principalTzs: num('principalTzs'),
    burnAmountTzs: burn.amountTzs,
    // Settlement evidence — the token is the product for a bill purchase.
    utilityToken: str('utilityToken'),
    utilityUnits: str('utilityUnits'),
    utilityReceipt: str('utilityReceipt'),
    selcomReceipt: str('selcomReceipt'),
    actualChargesTzs: num('actualChargesTzs'),
    createdAt: burn.createdAt,
  })
}
