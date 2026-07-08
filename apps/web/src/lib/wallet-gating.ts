/**
 * Sandbox wallet-creation gate.
 *
 * BoT Testing Parameter 8 requires every nTZS wallet to be linked to a KYC-verified
 * identity — no anonymous wallets. Until the Selcom bank-grade KYC product is live,
 * both the direct consumer app and the WaaS API can issue wallets with no KYC, so we
 * pause ALL new wallet creation.
 *
 * Defaults to PAUSED so it takes effect on deploy with no env change. To re-enable
 * (once KYC gates wallet issuance), set WALLET_CREATION_PAUSED=false.
 *
 * This blocks only NEW wallet issuance — existing users, wallets, deposits,
 * transfers, and withdrawals are unaffected.
 */
export const WALLET_CREATION_PAUSED =
  (process.env.WALLET_CREATION_PAUSED ?? 'true').toLowerCase() !== 'false'

export const WALLET_CREATION_PAUSED_MESSAGE =
  'New wallet creation is temporarily paused while KYC verification is being finalised. Existing accounts are unaffected.'
