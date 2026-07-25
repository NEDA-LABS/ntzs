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
 * CONFIRMED for Lipa/TanQR payouts (25 Jul 2026): the dashboard's dedicated
 * "Lipa/TanQR" charges table matches these tiers verbatim through the
 * 5,000,001–20,000,000 → 2,550 band, and the first live lipa payment (ref
 * 202607250630: 1,000 principal → 30 charged, "Fee 23, VAT 5, Ex Duty 2")
 * matched to the shilling. The >20M tiers below come from the send-money
 * columns only. ⚠ Bill-payment ("Pay Bills") tariff is a separate dashboard
 * table, not yet captured — bill quotes use these tiers as an estimate until
 * it is.
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
 * Selcom BILL-PAYMENT tariffs — dashboard "Selcom Business Charges → Pay
 * Bills" (captured 25 Jul 2026). Bills price by BILLER GROUP, not one table:
 *
 *  - Government group (dashboard label "GEPG, Dawasa, NHC, Traffic Fine,
 *    Tarura, Regional Water Bills, TRA"): FREE up to 20,000 TZS, then tiers.
 *  - Charged group (label "Luku, iTrust, Auric Air, Coastal Aviation,
 *    Flightlink, ZanAir, Zantas Air Services, Aramex"): tiers below.
 *  - "Free Biller Services" group: list not yet captured from the dashboard —
 *    until it is, billers not in the government set are priced on the
 *    CHARGED table (conservative for the reserve; the settlement's actual
 *    total_charges is recorded per transaction, so over-estimates surface as
 *    reserve surplus, never as a user shortfall).
 *
 * Charges inclusive of VAT + Excise; government levy separate where applicable.
 */
const SELCOM_BILL_GOV_TIERS: ReadonlyArray<readonly [number, number]> = [
  [20000, 0],
  [30000, 200], [40000, 300], [50000, 400], [100000, 500],
  [200000, 1000], [300000, 1500], [400000, 2000], [500000, 2500],
  [100000000, 3000],
]

const SELCOM_BILL_CHARGED_TIERS: ReadonlyArray<readonly [number, number]> = [
  [999, 12], [1999, 12], [2999, 24], [3999, 36], [4999, 48],
  [9999, 60], [19999, 120], [29999, 240], [39999, 360], [49999, 480],
  [99999, 600], [199999, 800], [299999, 1600], [399999, 2000], [499999, 2400],
  [599999, 2450], [699999, 2660], [799999, 2800], [899999, 2940], [1000000, 3080],
  [3000000, 3220], [10000000, 3360], [20000000, 3500],
]

/** Biller codes on the government (free-≤20k) tariff. Dashboard's "TRA" maps
 * to our TRAGEPG. ZANMALIPO (Zanzibar gov) is NOT in the dashboard label —
 * kept on the charged table until Selcom confirms (conservative). */
const SELCOM_GOV_TARIFF_BILLERS = new Set([
  'GEPG', 'DAWASA', 'NHC', 'TRAFFICFINE', 'TARURA', 'WATERBILLS', 'TRAGEPG',
])

/** Selcom's charge for a bill payment, by biller group. */
export function estimateBillPayFee(utilityCode: string, amount: number): number {
  const tiers = SELCOM_GOV_TARIFF_BILLERS.has(utilityCode.trim().toUpperCase())
    ? SELCOM_BILL_GOV_TIERS
    : SELCOM_BILL_CHARGED_TIERS
  for (const [max, charge] of tiers) {
    if (amount <= max) return charge
  }
  return tiers[tiers.length - 1][1]
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
