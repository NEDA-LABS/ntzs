import { NextRequest, NextResponse } from 'next/server'

import { requireAnyRole } from '@/lib/auth/rbac'
import { accountLookup, detectWalletFiCode, normalizePhone } from '@/lib/psp/selcom'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/admin/selcom-lookup-probe?phone=07XXXXXXXX[&codes=A,B,C]
 * GET /api/admin/selcom-lookup-probe?account=70031820[&codes=A,B,C]
 *
 * Browser-friendly super-admin probe (same pattern that cracked the AzamPay
 * TQS vocabulary): runs /v1/account/lookup for the SAME number under several
 * candidate `bank` codes side by side and returns each attempt's name or
 * refusal reason. Selcom's own Postman example uses bank=SELCOM for a wallet
 * MSISDN while the disbursement table lists *CASHIN codes — this shows,
 * from evidence, which vocabulary the lookup endpoint actually speaks.
 *
 * `phone` normalizes as an MSISDN and probes wallet vocabularies; `account`
 * passes through raw for non-phone identifiers (merchant Lipa Namba tills,
 * bank accounts) and probes bank=SELCOM plus any ?codes= you add.
 *
 * Read-only; results carry Selcom's resultcode/message, never credentials.
 */
export async function GET(request: NextRequest) {
  await requireAnyRole(['super_admin'])

  const phoneRaw = request.nextUrl.searchParams.get('phone')
  const accountRaw = request.nextUrl.searchParams.get('account')
  if (!phoneRaw && !accountRaw) {
    return NextResponse.json(
      { error: 'phone or account query param required, e.g. ?phone=0744277496 or ?account=70031820' },
      { status: 400 }
    )
  }

  let account: string
  let detected: string | null = null
  let mode: 'phone' | 'account'
  if (phoneRaw) {
    mode = 'phone'
    try {
      account = normalizePhone(phoneRaw)
    } catch (e) {
      return NextResponse.json({ error: `invalid phone: ${e instanceof Error ? e.message : e}` }, { status: 400 })
    }
    try {
      detected = detectWalletFiCode(account)
    } catch {
      detected = null
    }
  } else {
    mode = 'account'
    account = (accountRaw as string).replace(/\s+/g, '')
    if (!/^\d{4,20}$/.test(account)) {
      return NextResponse.json({ error: 'invalid account: digits only (4–20)' }, { status: 400 })
    }
  }

  const extra = (request.nextUrl.searchParams.get('codes') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)

  // Candidates: for phones — the shortcode-table code for this network plus
  // operator spellings; for raw accounts (tills etc.) — bank=SELCOM, which is
  // the vocabulary the lookup endpoint answered for wallets. ?codes= extends.
  const candidates =
    mode === 'phone'
      ? [...new Set([...(detected ? [detected] : []), 'SELCOM', 'VODACOM', 'MPESA', ...extra])]
      : [...new Set(['SELCOM', ...extra])]

  const attempts: Array<{ bank: string; name: string | null; operator?: string; reason?: string }> = []
  for (const bank of candidates) {
    const r = await accountLookup(bank, account)
    attempts.push({ bank, name: r.name, operator: r.operator, reason: r.reason })
  }

  const working = attempts.filter((a) => a.name)
  return NextResponse.json({
    mode,
    account,
    /** Back-compat alias for the original phone-only response shape. */
    phone: mode === 'phone' ? account : undefined,
    detectedShortcode: detected,
    attempts,
    conclusion:
      working.length > 0
        ? `Name resolves with bank=${working.map((w) => w.bank).join(', ')} — canonicalize this in detectWalletFiCode/lookup mapping.`
        : 'No candidate resolved a name — share this JSON output; the per-attempt reasons identify the next step.',
  })
}
