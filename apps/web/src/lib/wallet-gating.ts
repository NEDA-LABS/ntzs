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

/**
 * Direct-app sign-up pause — the BoT sandbox pilot is capped at 100
 * participants, and the direct app (ntzs.co.tz/app) is past that, so NEW
 * accounts are closed here and redirected to the NEDApay app.
 *
 * Fail-closed: paused unless DIRECT_APP_SIGNUP_ENABLED is exactly 'true'.
 * Gates three surfaces, all BELOW the existing-user path so nobody who
 * already has a wallet is ever blocked:
 *  - /auth/sign-up: the NEDApay hand-off card replaces the sign-up form
 *  - /app/user activation screen: wallet-less accounts see the hand-off
 *    instead of the NIDA form
 *  - verifyNidaAction: refuses first-time verification for wallet-less
 *    accounts (UI-bypass belt); existing wallet holders may still verify
 *    (retro-KYC), and already-approved users still redirect through.
 */
export const DIRECT_APP_SIGNUP_PAUSED = process.env.DIRECT_APP_SIGNUP_ENABLED !== 'true'

/** Where new users go instead while the direct app is at pilot capacity. */
export const NEDAPAY_APP_URL = 'https://app.nedapay.xyz/'
