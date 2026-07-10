/**
 * Legacy sandbox wallet-creation gate — now an auxiliary flag only.
 *
 * KYC is a STRUCTURAL prerequisite for wallet issuance (BoT Parameter 8):
 * end-user wallets require a Selcom-verified NIDA, and partner sub-wallets
 * (business wallets) require approved KYB — both regardless of this flag.
 * It still gates:
 *  - the embedded-wallet (CDP) save action
 *  - the sign-up page banner copy
 */
export const WALLET_CREATION_PAUSED =
  (process.env.WALLET_CREATION_PAUSED ?? 'true').toLowerCase() !== 'false'

export const WALLET_CREATION_PAUSED_MESSAGE =
  'New wallet creation is temporarily paused while KYC verification is being finalised. Existing accounts are unaffected.'
