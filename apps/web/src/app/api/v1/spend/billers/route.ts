import { NextResponse } from 'next/server'

import { isTestMode } from '@/lib/testmode'
import { authenticatePartner } from '@/lib/waas/auth'
import { SELCOM_BILLERS, BILLER_CATEGORY_LABELS, type BillerCategory } from '@/lib/psp/selcom-billers'
import { estimateBillPayFee } from '@/lib/psp/selcom-fees'
import { nedaProtocolFeeTzs } from '@/lib/waas/protocol-fee'
import { spendEnabled } from '@/lib/waas/spend-quote'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/spend/billers — the bill-payment catalogue for partner UIs.
 *
 * Returns every supported biller (code, category, human label, reference
 * label + format rules) so a partner's bill-payment screen renders from live
 * data instead of a hardcoded list that drifts.
 *
 * ⚠ ON THE FEE FLAGS. `feeFreeUnder20k` used to be derived from the SELCOM leg
 * alone, so government billers advertised "no fee under 20,000" while the quote
 * charged one: a 1,000 TZS government bill still cost 35 TZS, because the
 * platform fee (0.5%) and the NEDA protocol fee (30 TZS floor) apply to every
 * spend regardless of biller or amount. Partners surfaced that flag as a "no
 * fee" badge, so we were making a pricing promise to a payer that we then did
 * not honour.
 *
 * The flag now means what its name says — the TOTAL is zero — which the
 * protocol-fee floor makes effectively never. `selcomFeeFreeUnder20k` carries
 * the narrower fact that is actually true and is still worth showing, and
 * `feeNote` is ready-made copy that states it without over-claiming, so the
 * true statement cannot be paraphrased back into a promise.
 *
 * The authoritative fee for any amount still comes from POST /api/v1/spend/quote;
 * this is the picker's metadata, not a pricing API.
 */
/** Probe amount inside the government tier — high enough to be a realistic
 *  bill, low enough to sit under the 20,000 TZS threshold. */
const FEE_PROBE_TZS = 15_000

function billerFeeFlags(code: string): {
  feeFreeUnder20k: boolean
  selcomFeeFreeUnder20k: boolean
  feeNote: string | null
} {
  const selcomFree = estimateBillPayFee(code, FEE_PROBE_TZS) === 0
  // The protocol fee has a floor, so it lands on every spend however small.
  // The partner's own fee percentage sits on top of this and varies, so the
  // total can only ever be higher than what we check here — never lower.
  const unavoidable = nedaProtocolFeeTzs(FEE_PROBE_TZS)

  return {
    // Only true if a payer would genuinely be charged nothing.
    feeFreeUnder20k: selcomFree && unavoidable === 0,
    selcomFeeFreeUnder20k: selcomFree,
    feeNote: selcomFree
      ? 'Selcom charges no fee on this biller under 20,000 TZS. A service fee still applies — show the total from POST /api/v1/spend/quote.'
      : null,
  }
}

export async function GET(request: import('next/server').NextRequest) {
  const authResult = await authenticatePartner(request)
  if ('error' in authResult) return authResult.error

  // TEST MODE: the catalogue is static reference data, so it is served as-is —
  // only `enabled` differs, because every rail is on in the sandbox.
  const testMode = isTestMode(authResult.partner)

  const categories = (Object.keys(BILLER_CATEGORY_LABELS) as BillerCategory[]).map((cat) => ({
    key: cat,
    label: BILLER_CATEGORY_LABELS[cat],
    billers: SELCOM_BILLERS.filter((b) => b.category === cat).map((b) => ({
      code: b.code,
      referenceLabel: b.refLabel,
      referenceKind: b.refKind,
      referenceMinLength: b.refMin ?? null,
      referenceMaxLength: b.refMax ?? null,
      // Probed at 15,000 — inside the government tier — which reveals the
      // group without leaking the whole tariff table.
      ...billerFeeFlags(b.code),
    })),
  }))

  return NextResponse.json({
    enabled: testMode || spendEnabled(),
    ...(testMode ? { livemode: false } : {}),
    categories,
    note: 'Reference formats are validated at quote time. Always price with POST /api/v1/spend/quote — never hardcode fees, and never present selcomFeeFreeUnder20k as "no fee": a service fee applies to every payment.',
  })
}
