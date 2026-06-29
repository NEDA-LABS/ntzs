/**
 * Sanitize an environment variable value by stripping any surrounding quotes
 * that may have been accidentally included when setting the value in the
 * deployment platform (e.g. VALUE="https://..." instead of VALUE=https://...).
 */
function sanitizeEnv(value: string | undefined, fallback = ''): string {
  return (value || fallback).replace(/^["']|["']$/g, '')
}

export const BASE_RPC_URL = sanitizeEnv(
  process.env.BASE_RPC_URL,
  'https://mainnet.base.org'
)

export const NTZS_CONTRACT_ADDRESS_BASE = sanitizeEnv(
  process.env.NTZS_CONTRACT_ADDRESS_BASE ||
  process.env.NEXT_PUBLIC_NTZS_CONTRACT_ADDRESS_BASE,
  '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'
)

export const MINTER_PRIVATE_KEY = sanitizeEnv(process.env.MINTER_PRIVATE_KEY)
export const BURNER_PRIVATE_KEY = sanitizeEnv(process.env.BURNER_PRIVATE_KEY)
export const SNIPPE_API_KEY = sanitizeEnv(process.env.SNIPPE_API_KEY)

export const AZAMPAY_APP_NAME = sanitizeEnv(process.env.AZAMPAY_APP_NAME)
export const AZAMPAY_CLIENT_ID = sanitizeEnv(process.env.AZAMPAY_CLIENT_ID)
export const AZAMPAY_CLIENT_SECRET = sanitizeEnv(process.env.AZAMPAY_CLIENT_SECRET)
export const AZAMPAY_WEBHOOK_SECRET = sanitizeEnv(process.env.AZAMPAY_WEBHOOK_SECRET)
export const AZAMPAY_BANK_NAME = sanitizeEnv(process.env.AZAMPAY_BANK_NAME, 'nmb')
export const AZAMPAY_ENV = sanitizeEnv(process.env.AZAMPAY_ENV, 'sandbox')

/**
 * Address that receives withdrawal platform fees (minted on burn).
 * Used as a fallback when a burn is not associated with a partner that has
 * its own `treasury_wallet_address` configured.
 */
export const PLATFORM_TREASURY_ADDRESS = sanitizeEnv(process.env.PLATFORM_TREASURY_ADDRESS)

/**
 * Platform fee taken from LP spread on every SimpleFX swap fill, in basis points.
 * Defaults to 20 bps (0.20%). The fee is carved from the LP's earned spread —
 * the user-facing rate is unchanged.
 */
export const PLATFORM_FX_FEE_BPS = parseInt(process.env.PLATFORM_FX_FEE_BPS ?? '20', 10)

/**
 * NEDA's protocol cut on the Ramp corridor, in bps of the gross TZS. The
 * customer already pays a platform fee (PLATFORM_FEE_PCT); this only splits it —
 * NEDA takes RAMP_NEDA_FEE_BPS (capped at the total platform fee) and the partner
 * keeps the remainder. The customer-facing price is unchanged. Partners with no
 * treasury → NEDA takes the whole platform fee (the prior fallback).
 */
export const RAMP_NEDA_FEE_BPS = parseInt(process.env.RAMP_NEDA_FEE_BPS ?? '20', 10)

/**
 * Minimum pending protocol fee (in token units) before the sweep cron triggers
 * an on-chain transfer to treasury — avoids burning gas on dust amounts.
 * NTZS is TZS-denominated so the threshold is higher.
 */
export const FX_SWEEP_MIN_NTZS    = parseFloat(process.env.FX_SWEEP_MIN_NTZS    ?? '10000')
export const FX_SWEEP_MIN_STABLE  = parseFloat(process.env.FX_SWEEP_MIN_STABLE  ?? '5')
