import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import {
  RECOVERABLE_DEPOSIT_STATUSES,
  isRecoverableDepositStatus,
  isRecoveryAdvance,
} from './recoverable'
import { initiateCollection } from '../psp'

/**
 * INC 4 Aug 2026 — a customer's 105,000 TZS collection went unminted for ~15h.
 *
 * The chain: initiation reported a failure → we closed the deposit `rejected`
 * → the PSP had taken the money anyway → the completion webhook required
 * status='submitted' and discarded the event → no poller covered Snippe mobile
 * → a rejected row had no action in backstage. Five independent failures, each
 * of which alone would have saved the money.
 *
 * These pin all five. They are deliberately about MONEY NOT BEING LOST, not
 * about implementation shape.
 */

describe('recoverable deposit statuses', () => {
  it('a confirmed collection can still advance a closed deposit', () => {
    expect(isRecoverableDepositStatus('submitted')).toBe(true)
    expect(isRecoverableDepositStatus('rejected')).toBe(true)
    expect(isRecoverableDepositStatus('cancelled')).toBe(true)
  })

  it('NEVER re-advances a deposit already heading to a mint (double-mint guard)', () => {
    for (const s of ['mint_pending', 'mint_requires_safe', 'mint_processing', 'minted']) {
      expect(isRecoverableDepositStatus(s), `${s} must not be recoverable`).toBe(false)
    }
  })

  it('distinguishes a recovery from a normal advance, for alerting', () => {
    expect(isRecoveryAdvance('rejected')).toBe(true)
    expect(isRecoveryAdvance('cancelled')).toBe(true)
    expect(isRecoveryAdvance('submitted')).toBe(false)
  })
})

describe('uncertain initiations stay recoverable', () => {
  const railEnv = {
    ...process.env,
    ACTIVE_MOBILE_PSP: 'snippe',
    SNIPPE_API_KEY: 'test-key',
    COLLECTION_RAIL_PRIORITY: 'snippe',
  }

  it('a thrown/timed-out rail is NOT reported as a definitive failure', async () => {
    const saved = { ...process.env }
    Object.assign(process.env, railEnv)
    const savedFetch = globalThis.fetch
    // Transport failure — the request may well have reached the PSP.
    globalThis.fetch = (async () => {
      throw new Error('socket hang up')
    }) as typeof fetch

    try {
      const routed = await initiateCollection({
        amountTzs: 105000,
        phoneNumber: '255713712057',
        customerEmail: 'x@example.com',
        webhookBaseUrl: 'https://example.com',
        metadata: {},
      })
      expect(routed.payment.success).toBe(false)
      // THE POINT: absent/false here is what keeps the deposit row open.
      expect(routed.payment.definitiveFailure).not.toBe(true)
    } finally {
      globalThis.fetch = savedFetch
      for (const k of Object.keys(process.env)) delete process.env[k]
      Object.assign(process.env, saved)
    }
  })

  it('a 5xx is uncertain, a 4xx refusal is definitive', async () => {
    const saved = { ...process.env }
    Object.assign(process.env, railEnv)
    const savedFetch = globalThis.fetch

    const run = async (httpStatus: number) => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ status: 'error', message: 'nope' }), {
          status: httpStatus,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch
      return initiateCollection({
        amountTzs: 105000,
        phoneNumber: '255713712057',
        customerEmail: 'x@example.com',
        webhookBaseUrl: 'https://example.com',
        metadata: {},
      })
    }

    try {
      // Snippe broke mid-request — it may have queued the push first.
      expect((await run(503)).payment.definitiveFailure).not.toBe(true)
      // Snippe adjudicated and said no.
      expect((await run(400)).payment.definitiveFailure).toBe(true)
    } finally {
      globalThis.fetch = savedFetch
      for (const k of Object.keys(process.env)) delete process.env[k]
      Object.assign(process.env, saved)
    }
  })
})

describe('the five failures that stranded 105,000 TZS', () => {
  const WEB = path.join(__dirname, '../..')
  const read = (p: string) => fs.readFileSync(path.join(WEB, p), 'utf8')

  it('1. the partner API does not close a deposit on an uncertain initiation', () => {
    const src = read('app/api/v1/deposits/route.ts')
    expect(src).toContain('routed.payment.definitiveFailure')
    expect(src).toContain('initiation_uncertain')
    // And it tells the caller to poll rather than retry — a blind retry is how
    // one payment ended up with two attempt rows.
    expect(src).toContain('DO NOT retry')
  })

  it('2. the consumer app does not cancel on an uncertain initiation', () => {
    const src = read('app/app/user/deposits/new/actions.ts')
    expect(src).toContain('UncertainInitiationError')
    // The blanket catch must not undo it, and must not cancel after the PSP
    // has already accepted the collection.
    expect(src).toContain('initiationAccepted')
    expect(src).toContain('!initiationAccepted && !(error instanceof UncertainInitiationError)')
  })

  it('3. both payment webhooks recover a closed deposit', () => {
    for (const p of ['app/api/webhooks/snippe/payment/route.ts', 'app/api/webhooks/azampay/payment/route.ts']) {
      const src = read(p)
      expect(src, `${p} must use the shared recoverable set`).toContain('RECOVERABLE_DEPOSIT_STATUSES')
      expect(src, `${p} must not silently drop a recovery`).toContain('recovered_from_closed')
    }
  })

  it('3b. the webhooks keep the amount + currency cross-checks that make recovery safe', () => {
    const snippe = read('app/api/webhooks/snippe/payment/route.ts')
    expect(snippe).toContain("paidCurrency !== 'TZS'")
    expect(snippe).toContain('< deposit.amountTzs')
  })

  it('4. poll-snippe covers Snippe MOBILE, not just card', () => {
    const src = read('app/api/cron/poll-snippe/route.ts')
    expect(src).toContain("['snippe', 'snippe_card']")
    // And it must query Snippe directly — the '@/lib/psp' router would pick an
    // implementation from the global provider switch and could ask AzamPay
    // about a Snippe reference.
    expect(src).toContain("from '@/lib/psp/snippe'")
    // Unpollable rows must not squat the query window.
    expect(src).toContain('isNotNull(depositRequests.pspReference)')
  })

  it('5. backstage can recover a paid-but-closed deposit without SQL', () => {
    const src = read('app/backstage/minting/page.tsx')
    expect(src).toContain('recoverClosedDepositAction')
    // Evidence is mandatory, and one payment may only credit one deposit.
    expect(src).toContain('deposit.recovered_by_operator')
    expect(src).toContain('is already on deposit')
    // Recovery must NOT mint directly — it routes back through Approve Mint.
    expect(src).toContain("status: 'bank_approved'")
  })
})
