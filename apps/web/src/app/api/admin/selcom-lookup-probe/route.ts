import { NextRequest, NextResponse } from 'next/server'

import { requireAnyRole } from '@/lib/auth/rbac'
import { accountLookup, detectWalletFiCode, normalizePhone } from '@/lib/psp/selcom'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/admin/selcom-lookup-probe?phone=07XXXXXXXX[&codes=A,B,C]
 *
 * Browser-friendly super-admin probe (same pattern that cracked the AzamPay
 * TQS vocabulary): runs /v1/account/lookup for the SAME number under several
 * candidate `bank` codes side by side and returns each attempt's name or
 * refusal reason. Selcom's own Postman example uses bank=SELCOM for a wallet
 * MSISDN while the disbursement table lists *CASHIN codes — this shows,
 * from evidence, which vocabulary the lookup endpoint actually speaks.
 *
 * Read-only; results carry Selcom's resultcode/message, never credentials.
 */
export async function GET(request: NextRequest) {
  await requireAnyRole(['super_admin'])

  const phoneRaw = request.nextUrl.searchParams.get('phone')
  if (!phoneRaw) {
    return NextResponse.json({ error: 'phone query param required, e.g. ?phone=0744277496' }, { status: 400 })
  }

  let phone: string
  try {
    phone = normalizePhone(phoneRaw)
  } catch (e) {
    return NextResponse.json({ error: `invalid phone: ${e instanceof Error ? e.message : e}` }, { status: 400 })
  }

  let detected: string | null = null
  try {
    detected = detectWalletFiCode(phone)
  } catch {
    detected = null
  }

  const extra = (request.nextUrl.searchParams.get('codes') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)

  // Candidates: the shortcode-table code for this network, Selcom's own
  // example value, plausible operator spellings, plus any ?codes= overrides.
  const candidates = [...new Set([...(detected ? [detected] : []), 'SELCOM', 'VODACOM', 'MPESA', ...extra])]

  const attempts: Array<{ bank: string; name: string | null; operator?: string; reason?: string }> = []
  for (const bank of candidates) {
    const r = await accountLookup(bank, phone)
    attempts.push({ bank, name: r.name, operator: r.operator, reason: r.reason })
  }

  const working = attempts.filter((a) => a.name)
  return NextResponse.json({
    phone,
    detectedShortcode: detected,
    attempts,
    conclusion:
      working.length > 0
        ? `Name resolves with bank=${working.map((w) => w.bank).join(', ')} — canonicalize this in detectWalletFiCode/lookup mapping.`
        : 'No candidate resolved a name — share this JSON output; the per-attempt reasons identify the next step.',
  })
}
