import { NextResponse } from 'next/server'

import { authenticatePartner } from '@/lib/waas/auth'
import { SELCOM_BILLERS, BILLER_CATEGORY_LABELS, type BillerCategory } from '@/lib/psp/selcom-billers'
import { estimateBillPayFee } from '@/lib/psp/selcom-fees'
import { spendEnabled } from '@/lib/waas/spend-quote'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/spend/billers — the bill-payment catalogue for partner UIs.
 *
 * Returns every supported biller (code, category, human label, reference
 * label + format rules) so a partner's bill-payment screen renders from live
 * data instead of a hardcoded list that drifts. `feeFree` flags the
 * government billers that are free up to 20,000 TZS — the headline a partner
 * will want to surface. The authoritative fee for any amount still comes from
 * POST /api/v1/spend/quote; this is the picker's metadata, not a pricing API.
 */
export async function GET(request: import('next/server').NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  const categories = (Object.keys(BILLER_CATEGORY_LABELS) as BillerCategory[]).map((cat) => ({
    key: cat,
    label: BILLER_CATEGORY_LABELS[cat],
    billers: SELCOM_BILLERS.filter((b) => b.category === cat).map((b) => ({
      code: b.code,
      referenceLabel: b.refLabel,
      referenceKind: b.refKind,
      referenceMinLength: b.refMin ?? null,
      referenceMaxLength: b.refMax ?? null,
      // Government billers are free ≤20k — a zero fee at 15k reveals the group
      // without leaking the whole tariff table.
      feeFreeUnder20k: estimateBillPayFee(b.code, 15_000) === 0,
    })),
  }))

  return NextResponse.json({
    enabled: spendEnabled(),
    categories,
    note: 'Reference formats are validated at quote time. Always price with POST /api/v1/spend/quote — never hardcode fees.',
  })
}
