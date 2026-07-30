/**
 * Developer TEST MODE — public surface.
 *
 * A v1 route wires test mode in exactly one place, immediately after
 * authentication and BEFORE any money code runs:
 *
 *   const { partner } = authResult
 *   if (isTestMode(partner)) return testCreateWithdrawal(partner, request)
 *
 * That ordering is the contract: nothing below the branch may execute for a
 * test partner. testmode/route-coverage.test.ts fails CI if a v1 route that
 * authenticates a partner has no branch and is not explicitly exempted.
 *
 * ⚠ Not to be confused with the Bank of Tanzania regulatory sandbox
 * (lib/sandbox/limits.ts). See mode.ts.
 */

export {
  isTestMode,
  normalizeMode,
  generateTestApiKey,
  testModeSignupEnabled,
  testModeSignupDailyCap,
  settleDelayMs,
  TEST_KEY_PREFIX,
  type PartnerMode,
} from './mode'

export { TEST_SCENARIOS } from './scenarios'

export {
  testCreateUser,
  testGetUser,
  testCreateDeposit,
  testGetDeposit,
  testWithdrawalQuote,
  testCreateWithdrawal,
  testGetWithdrawal,
  testSpendQuote,
  testCreateSpend,
  testGetSpend,
  testCreateTransfer,
  testLookupName,
  testLookupMerchant,
  testNotSupported,
} from './handlers'

export { settleDue, resetPartner, listTransactions, approveUser, findUserById } from './engine'
