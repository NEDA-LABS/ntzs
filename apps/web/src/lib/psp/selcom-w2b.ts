/**
 * Server-side config for Selcom w2b (Lipa Namba) deposits.
 *
 * Separate flag from SELCOM_COLLECTIONS_ENABLED on purpose: push-USSD is not
 * live yet on Selcom's side, but w2b works today — the two go live
 * independently. Both write paymentProvider 'selcom', so BOTH require
 * drizzle/0061 applied in Neon before being enabled.
 */

export interface W2bConfig {
  lipaNamba: string
  /** Account name shown to the payer so they can confirm the right till. */
  accountName: string | null
}

/**
 * Returns the w2b config when the feature is fully on, else null.
 * Fail-closed: the flag AND the Lipa Namba must both be set — a flag without
 * a number would create intents nobody can pay.
 */
export function getW2bConfig(): W2bConfig | null {
  if (process.env.SELCOM_W2B_ENABLED !== 'true') return null
  const lipaNamba = (process.env.SELCOM_LIPA_NAMBA ?? '').trim()
  if (!lipaNamba) return null
  return {
    lipaNamba,
    accountName: (process.env.SELCOM_LIPA_NAME ?? '').trim() || null,
  }
}

/**
 * Bank-transfer collections (banking phase 3): the payer sends a TIPS bank
 * transfer to our Selcom account with a generated reference in the narration;
 * the selcom-statement-sync cron matches the credit by that token.
 */
export interface BankCollectionConfig {
  /** Account the payer transfers to — defaults to SELCOM_ACCOUNT_NUMBER (the
   * account whose statement we already poll), overridable in case the
   * TIPS-addressable number formats differently. */
  accountNumber: string
  /** Name on the account, shown so the payer can confirm before sending. */
  accountName: string | null
  /** Institution the payer selects in their bank app's TIPS transfer menu. */
  institution: string
}

/**
 * Returns the bank-collection config when the feature is fully on, else null.
 * Fail-closed like getW2bConfig: the flag AND a destination account must both
 * resolve — a flag without an account would create intents nobody can pay.
 */
export function getBankCollectionConfig(): BankCollectionConfig | null {
  if (process.env.SELCOM_BANK_COLLECTIONS_ENABLED !== 'true') return null
  const accountNumber = (
    process.env.SELCOM_BANK_COLLECTION_ACCOUNT ??
    process.env.SELCOM_ACCOUNT_NUMBER ??
    ''
  ).replace(/\s+/g, '')
  if (!accountNumber) return null
  return {
    accountNumber,
    accountName:
      (process.env.SELCOM_BANK_COLLECTION_NAME ?? '').trim() ||
      (process.env.SELCOM_LIPA_NAME ?? '').trim() ||
      null,
    institution: (process.env.SELCOM_BANK_COLLECTION_INSTITUTION ?? '').trim() || 'Selcom Paytech',
  }
}
