import crypto from 'crypto'

/**
 * Developer TEST MODE — the self-serve sandbox partners integrate against
 * before they touch real money.
 *
 * ⚠ TERMINOLOGY. In this codebase "sandbox" already means the **Bank of
 * Tanzania regulatory sandbox** (lib/sandbox/limits.ts — participant caps,
 * per-transaction caps). This module is the unrelated **developer** sandbox,
 * and is called TEST MODE everywhere to keep the two from ever being confused
 * in code, logs, or a regulator conversation.
 *
 * ── The safety property ───────────────────────────────────────────────────
 * Isolation is STRUCTURAL, not conditional. A test partner is a separate
 * `partners` row (mode='test') whose traffic is served entirely by
 * lib/testmode/: it never touches the chain, never calls a PSP, and writes
 * only to test_mode_users / test_mode_transactions. Attestation, on-chain
 * supply, the reserve pots and every Backstage aggregate read none of those
 * tables — so simulated money cannot reach a regulator-facing number, and
 * there is no "exclude test rows" filter anyone can forget.
 *
 * The invariant is enforced by testmode/route-coverage.test.ts: every v1 route
 * that authenticates a partner must dispatch test-mode traffic, or be listed
 * as explicitly exempt with a reason.
 */

export type PartnerMode = 'live' | 'test'

/** Prefix on every test-mode API key. Live keys never use it in production. */
export const TEST_KEY_PREFIX = 'ntzs_test_'

export function normalizeMode(value: string | null | undefined): PartnerMode {
  return value === 'test' ? 'test' : 'live'
}

/** THE branch. Anything true here must not reach chain/PSP/money tables. */
export function isTestMode(partner: { mode?: string | null }): boolean {
  return normalizeMode(partner.mode) === 'test'
}

/** `ntzs_test_` + 40 hex. Same entropy as a live key. */
export function generateTestApiKey(): string {
  return `${TEST_KEY_PREFIX}${crypto.randomBytes(20).toString('hex')}`
}

/**
 * Public self-serve test-key signup. Defaults ON — a sandbox nobody can reach
 * without emailing us is not a sandbox. Set TESTMODE_SIGNUP_ENABLED=false to
 * close it. It can only ever create mode='test' partners, which cannot move
 * money by construction.
 */
export function testModeSignupEnabled(): boolean {
  return process.env.TESTMODE_SIGNUP_ENABLED !== 'false'
}

/** Abuse ceiling on the unauthenticated signup route (rows/day). */
export function testModeSignupDailyCap(): number {
  const raw = Number(process.env.TESTMODE_SIGNUP_DAILY_CAP)
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 50
}

/**
 * How long a simulated transaction stays `pending` before it settles.
 * Long enough that an integrator SEES the pending state (and has to handle
 * it), short enough that a demo does not stall. Override in CI with 0.
 */
export function settleDelayMs(): number {
  const raw = Number(process.env.TESTMODE_SETTLE_DELAY_MS)
  return Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : 3000
}
