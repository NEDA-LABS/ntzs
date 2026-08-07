import { NextResponse } from 'next/server'

import { getSessionFromCookies } from '@/lib/fx/auth'
import { BANK_FI_CODES } from '@/lib/psp/selcom'

/**
 * GET /simplefx/api/lp/banks — payable banks for a cash-out destination.
 *
 * The canonical FI registry is server-only (it sits beside the Selcom client),
 * so the portal reads it here rather than hardcoding a list that would drift.
 * Empty when the payout rail is off, which is what hides the option in the UI.
 */
export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (process.env.SELCOM_DISBURSEMENTS_ENABLED !== 'true') {
    return NextResponse.json({ banks: [], enabled: false })
  }

  const banks = Object.entries(BANK_FI_CODES)
    .map(([code, meta]) => ({ code, name: meta.name, reference: meta.reference }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ banks, enabled: true })
}
