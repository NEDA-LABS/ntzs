/**
 * Per-provider payout fee model — the single source of truth for PSP fees.
 *
 * CLIENT-SAFE: this module must stay dependency-free (no node crypto, no DB)
 * because UI components may import it to display live fee quotes.
 *
 * All providers charge their fee ON TOP of the amount the recipient receives;
 * the gross-up math (lib/payouts/payout-math.ts) takes the fee as a parameter.
 */

/** Snippe: flat fee per mobile payout, debited from our Snippe balance. */
export const SNIPPE_FLAT_FEE_TZS = 1500

/** AzamPay: 1% of the disbursed amount, regardless of size. */
export function azampayPayoutFee(receiveAmountTzs: number): number {
  return Math.ceil(receiveAmountTzs * 0.01)
}

/**
 * Selcom "Send Money → Other Banks / Mobile Wallets / Lipa" tariff, from the
 * portal's "Selcom Business Charges" (captured 6 Jul 2026). Tiers are
 * [maxAmountInclusive, charge]; charges are INCLUSIVE of VAT + Excise. A
 * government levy may apply separately "where applicable" — confirm for
 * wallet/bank sends. Selcom-to-Selcom (SB2SELCOM) is FREE.
 *
 * ⚠ This is the published production tariff — the SANDBOX returns different
 * (inflated) fees, so treat this as the estimate and the disbursement
 * response's `total_charges` as authoritative for the actual amount charged.
 */
const SELCOM_SEND_MONEY_FEE_TIERS: ReadonlyArray<readonly [number, number]> = [
  [999, 10], [1999, 30], [2999, 40], [3999, 50], [4999, 60],
  [6999, 150], [9999, 160], [14999, 300], [19999, 300], [29999, 400],
  [39999, 500], [50000, 550], [99999, 950], [199999, 1000], [299999, 1100],
  [399999, 1200], [499999, 1250], [599999, 1250], [699999, 1500], [799999, 1700],
  [899999, 1800], [999999, 1900], [5000000, 1900], [20000000, 2550],
  [50000000, 5000], [100000000, 8000], [200000000, 10000],
]

/** Look up the Selcom send-money fee for an amount (external wallet/bank rail). */
export function estimateSendMoneyFee(amount: number): number {
  for (const [max, charge] of SELCOM_SEND_MONEY_FEE_TIERS) {
    if (amount <= max) return charge
  }
  return SELCOM_SEND_MONEY_FEE_TIERS[SELCOM_SEND_MONEY_FEE_TIERS.length - 1][1]
}

/**
 * The PSP fee (TZS) for a mobile/bank payout where the recipient receives
 * `receiveAmountTzs`. Unknown/legacy provider tags fall back to the Snippe
 * flat fee (Snippe was the only historical rail).
 */
export function getPayoutFeeTzs(provider: string | null | undefined, receiveAmountTzs: number): number {
  switch (provider) {
    case 'azampay':
      return azampayPayoutFee(receiveAmountTzs)
    case 'selcom':
      return estimateSendMoneyFee(receiveAmountTzs)
    default:
      return SNIPPE_FLAT_FEE_TZS
  }
}
