import crypto from 'crypto'
import { ethers } from 'ethers'

/**
 * Test-mode scenarios — deterministic "magic values" that let an integrator
 * exercise every branch of the API without waiting for a real failure.
 *
 * ONE rule to remember, applied uniformly:
 *
 *   the last two digits decide the outcome
 *     …13 → fails       (payout reverted / collection declined)
 *     …02 → needs reconciliation (burn done, payment unconfirmed — no refund)
 *     …99 → stays pending forever (timeout / stuck-transaction handling)
 *     anything else → completes
 *
 * For a DEPOSIT the digits come from the amount; for anything that pays out
 * (withdrawal phone, Lipa till, bill reference) they come from the
 * destination. Nothing else is special — every other value succeeds.
 */

export type TestOutcome = 'complete' | 'fail' | 'reconcile' | 'hang'

/** Last two digits of the trailing numeric run in a value ('' when none). */
function lastTwoDigits(value: string | number | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 2 ? digits.slice(-2) : digits
}

function outcomeFromDigits(digits: string): TestOutcome {
  if (digits === '13') return 'fail'
  if (digits === '02') return 'reconcile'
  if (digits === '99') return 'hang'
  return 'complete'
}

/** Deposits are driven by the AMOUNT (the destination is the user's own wallet). */
export function depositOutcome(amountTzs: number): TestOutcome {
  return outcomeFromDigits(lastTwoDigits(amountTzs))
}

/** Payouts are driven by the DESTINATION: phone, Lipa till, or bill reference. */
export function payoutOutcome(destination: string): TestOutcome {
  return outcomeFromDigits(lastTwoDigits(destination))
}

/**
 * Registered-name lookup. Two tills mirror real, verified production
 * counterparties so a demo shows a name an operator recognises; everything
 * else gets a stable pseudo-random Tanzanian name. A destination ending `00`
 * has no registered name — the "we could not verify this merchant" branch.
 */
const KNOWN_NAMES: Record<string, string> = {
  '61115582': 'ENZI COFFEE COMPANY LIMITED',
  '70031820': 'NEDA LABS LIMITED',
}

const NAME_POOL = [
  'ASHA MOHAMED JUMA',
  'BAKARI SALUM HAMISI',
  'NEEMA JOSEPH MWANRI',
  'ZAINABU HAMISI ALLY',
  'EMMANUEL PETER MSIGWA',
  'FATUMA RAMADHANI SAID',
  'GODFREY JOHN MTUI',
  'REHEMA DANIEL KIMARO',
] as const

export function testRecipientName(destination: string): string | null {
  const key = String(destination ?? '').replace(/\D/g, '')
  if (!key) return null
  if (KNOWN_NAMES[key]) return KNOWN_NAMES[key]
  if (lastTwoDigits(key) === '00') return null // unverifiable destination
  const idx = crypto.createHash('sha256').update(key).digest()[0] % NAME_POOL.length
  return NAME_POOL[idx]
}

/**
 * A NIDA ending in `0000` lands in manual review (the `202 kyc_pending_review`
 * contract). Every other well-formed NIDA verifies instantly — test mode never
 * calls the real identity registry.
 */
export function testKycStatus(nidaNumber: string): 'approved' | 'pending_review' {
  return nidaNumber.replace(/\D/g, '').slice(-4) === '0000' ? 'pending_review' : 'approved'
}

// ── Deterministic fake chain values ────────────────────────────────────────
// Valid-format, checksummed, and stable for a given input — so a partner can
// store a test wallet address and see the same one back — but never funded,
// never deployed, never on Base.

function digest(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex')
}

export function testWalletAddress(partnerId: string, externalId: string): string {
  return ethers.getAddress(`0x${digest('testmode-wallet', partnerId, externalId).slice(0, 40)}`)
}

export function testTxHash(...seed: string[]): string {
  return `0x${digest('testmode-tx', ...seed)}`
}

/** Selcom-shaped receipt for spend settlements (SB + 8 alphanumerics). */
export function testReceipt(seed: string): string {
  return `SB${digest('testmode-receipt', seed).slice(0, 8).toUpperCase()}`
}

/**
 * Machine-readable cheat sheet served by GET /api/v1/testmode and rendered in
 * the developer portal — one source of truth so the docs cannot drift from
 * the behaviour.
 */
export const TEST_SCENARIOS = [
  {
    trigger: 'amount ends in 13 (deposit) · destination ends in 13 (payout)',
    result: 'fails',
    detail:
      'Deposit is declined and never credits. A withdrawal/spend burns, the payment fails, and the burn is reverted — the balance comes back.',
  },
  {
    trigger: 'destination ends in 02',
    result: 'reconcile_required',
    detail:
      'The burn completed but the payment could not be confirmed. The balance is NOT restored and the transaction stays under review — exercise your "do not retry" path.',
  },
  {
    trigger: 'amount or destination ends in 99',
    result: 'stays pending',
    detail: 'Never settles. Use it to test timeouts, polling limits, and stuck-transaction handling.',
  },
  {
    trigger: 'Lipa till 61115582 / 70031820',
    result: 'named merchant',
    detail: 'Resolves to ENZI COFFEE COMPANY LIMITED / NEDA LABS LIMITED (real, verified production counterparties).',
  },
  {
    trigger: 'destination ends in 00',
    result: 'no registered name',
    detail: 'Name lookup returns null — render the "unverified destination" warning.',
  },
  {
    trigger: 'NIDA ends in 0000',
    result: '202 kyc_pending_review',
    detail: 'User is created without a wallet and lands in manual review. Any other 20-digit NIDA verifies instantly.',
  },
  { trigger: 'anything else', result: 'completes', detail: 'The happy path.' },
] as const
