import { BANK_FI_CODES } from '@/lib/psp/selcom'

/**
 * Bank payout destination (banking phase 2, 3 Aug 2026) — the partner-facing
 * alternative to `phoneNumber` on withdrawal quote + execute. Codes come from
 * the canonical FI registry, never free text; the account format follows the
 * bank's reference type (CRDB is the only alphanumeric one).
 */
export type BankDestination = { code: string; account: string }

/**
 * Parse and validate an optional bank destination from a request body.
 * Returns null when no bank fields are present (wallet flow), the destination
 * when valid, or {error, status} when the fields are present but wrong —
 * shared by quote and execute so the two can never disagree on validity.
 */
export function resolveBankDestination(body: {
  bankCode?: string
  accountNumber?: string
}): BankDestination | { error: string; status: number } | null {
  const rawCode = body.bankCode?.trim().toUpperCase()
  const rawAccount = body.accountNumber?.trim()
  if (!rawCode && !rawAccount) return null
  if (!rawCode || !rawAccount) {
    return { error: 'bankCode and accountNumber must be provided together', status: 400 }
  }
  const bank = BANK_FI_CODES[rawCode]
  if (!bank) {
    return { error: `Unknown bankCode '${rawCode}' — must be a canonical Selcom FI code (see the partner API reference)`, status: 400 }
  }
  const accountOk = bank.reference === 'alphanumeric'
    ? /^[A-Za-z0-9]{5,24}$/.test(rawAccount)
    : /^\d{5,20}$/.test(rawAccount)
  if (!accountOk) {
    return {
      error: `accountNumber must be ${bank.reference === 'alphanumeric' ? '5–24 alphanumeric characters' : '5–20 digits'} for ${bank.name}`,
      status: 400,
    }
  }
  return { code: rawCode, account: rawAccount }
}

/** Last-4 masking for user-facing confirmation strings. */
export function maskAccount(account: string): string {
  return account.length <= 4 ? account : `•••${account.slice(-4)}`
}
