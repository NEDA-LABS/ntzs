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
