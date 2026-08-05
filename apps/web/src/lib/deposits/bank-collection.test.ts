import fs from 'fs'
import path from 'path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { allocateBankReference, bankTransferInstructions } from './bank-collection'
import { getBankCollectionConfig } from '../psp/selcom-w2b'

/**
 * Banking phase 3 (3 Aug 2026): bank-transfer collections. A generated
 * reference token (NTZ-XXXXXX) is the matching key — TIPS credits carry no
 * payer phone. These pin the allocator, the fail-closed config, and the wiring
 * that keeps the token lifecycle safe across intent → statement match → mint.
 */

type FakeDb = Parameters<typeof allocateBankReference>[0]

function fakeDb(clashRows: number): FakeDb {
  let calls = 0
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(calls++ < clashRows ? [{ id: 'existing' }] : []),
  }
  return chain as unknown as FakeDb
}

describe('allocateBankReference', () => {
  it('returns a canonical token when no open intent holds it', async () => {
    const token = await allocateBankReference(fakeDb(0))
    expect(token).toMatch(/^NTZ[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/)
  })

  it('retries past collisions and gives up loudly after 5 attempts', async () => {
    await expect(allocateBankReference(fakeDb(2))).resolves.toMatch(/^NTZ/)
    await expect(allocateBankReference(fakeDb(99))).rejects.toThrow('unique bank reference')
  })
})

describe('getBankCollectionConfig', () => {
  const KEYS = [
    'SELCOM_BANK_COLLECTIONS_ENABLED',
    'SELCOM_BANK_COLLECTION_ACCOUNT',
    'SELCOM_BANK_COLLECTION_NAME',
    'SELCOM_BANK_COLLECTION_INSTITUTION',
    'SELCOM_ACCOUNT_NUMBER',
    'SELCOM_LIPA_NAME',
  ] as const
  const saved: Record<string, string | undefined> = {}
  beforeAll(() => {
    for (const k of KEYS) saved[k] = process.env[k]
  })
  afterAll(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('is fail-closed: flag without an account resolves to null', () => {
    for (const k of KEYS) delete process.env[k]
    expect(getBankCollectionConfig()).toBeNull()
    process.env.SELCOM_BANK_COLLECTIONS_ENABLED = 'true'
    expect(getBankCollectionConfig()).toBeNull()
  })

  it('defaults the payer-facing account to SELCOM_ACCOUNT_NUMBER, override wins', () => {
    process.env.SELCOM_BANK_COLLECTIONS_ENABLED = 'true'
    process.env.SELCOM_ACCOUNT_NUMBER = '6600 0000 111'
    delete process.env.SELCOM_BANK_COLLECTION_ACCOUNT
    expect(getBankCollectionConfig()?.accountNumber).toBe('66000000111')
    process.env.SELCOM_BANK_COLLECTION_ACCOUNT = '77700011122'
    expect(getBankCollectionConfig()?.accountNumber).toBe('77700011122')
  })

  it('falls back through the name chain and defaults the institution', () => {
    process.env.SELCOM_BANK_COLLECTIONS_ENABLED = 'true'
    process.env.SELCOM_BANK_COLLECTION_ACCOUNT = '77700011122'
    delete process.env.SELCOM_BANK_COLLECTION_NAME
    process.env.SELCOM_LIPA_NAME = 'NEDA LABS LIMITED'
    delete process.env.SELCOM_BANK_COLLECTION_INSTITUTION
    const cfg = getBankCollectionConfig()
    expect(cfg?.accountName).toBe('NEDA LABS LIMITED')
    expect(cfg?.institution).toBe('Selcom Paytech')
  })
})

describe('bankTransferInstructions', () => {
  it('tells the payer the three things matching depends on', () => {
    const ins = bankTransferInstructions(
      { accountNumber: '66000000111', accountName: 'NEDA LABS', institution: 'Selcom Paytech' },
      'NTZ7K2M9Q',
      15000
    )
    // Bare token: bank narration fields routinely reject punctuation.
    expect(ins.reference).toBe('NTZ7K2M9Q')
    expect(ins.amountTzs).toBe(15000)
    expect(ins.note).toContain('EXACTLY')
    expect(ins.note).toContain('NTZ7K2M9Q')
    expect(ins.note).toContain('narration')
    expect(ins.note).toContain('72 hours')
  })
})

describe('bank collections wiring', () => {
  const WEB = path.join(__dirname, '../..')
  const read = (p: string) => fs.readFileSync(path.join(WEB, p), 'utf8')

  it('the partner API stamps the SELCOM-BANK channel and the token, gated fail-closed', () => {
    const src = read('app/api/v1/deposits/route.ts')
    expect(src).toContain("paymentMethod === 'bank_transfer'")
    expect(src).toContain('getBankCollectionConfig()')
    expect(src).toContain('bank_transfer deposits are not enabled')
    expect(src).toContain('pspChannel: BANK_CHANNEL')
    expect(src).toContain('allocateBankReference(')
    expect(src).toContain('pspReference: reference')
  })

  it('the user app creates intents through the same allocator and channel', () => {
    const src = read('app/app/user/deposits/new/actions.ts')
    expect(src).toContain('createBankDepositIntentAction')
    expect(src).toContain('allocateBankReference(')
    expect(src).toContain('pspChannel: BANK_CHANNEL')
  })

  it('the statement cron runs the bank pass and never dies with Lipa Namba off', () => {
    const src = read('app/api/cron/selcom-statement-sync/route.ts')
    // Gate: either statement-settled channel keeps the cron alive.
    expect(src).toContain('!getW2bConfig() && !getBankCollectionConfig()')
    expect(src).toContain('suggestBankMatch(')
    // The claim must stay conditional so a concurrent manual attach can't double-credit.
    expect(src.split("eq(orphanPayments.status, 'unmatched')").length).toBeGreaterThanOrEqual(3)
    // Wrong-amount/token-collision credits go to a human, with a breadcrumb.
    expect(src).toContain('bankDeferredToManual')
    expect(src).toContain('deposit.bank_intent_auto_matched')
  })

  it('poll-selcom never sweeps statement-settled intents into pushussd queries', () => {
    // A SELCOM-BANK intent holds OUR token in pspReference while open —
    // querying Selcom with it could read failed/expired and reject the row.
    const src = read('app/api/cron/poll-selcom/route.ts')
    expect(src).toContain('STATEMENT_SETTLED_CHANNELS')
    expect(src).toContain('isNull(depositRequests.pspChannel)')
  })

  it('the status route echoes the reference ONLY while the intent is open', () => {
    const src = read('app/api/v1/deposits/[id]/route.ts')
    expect(src).toContain("deposit.pspChannel === BANK_CHANNEL && deposit.status === 'submitted'")
    expect(src).toContain('formatBankReference(')
  })

  it('test mode issues the same reference shape as live', () => {
    const src = read('lib/testmode/handlers.ts')
    expect(src).toContain("paymentMethod === 'bank_transfer'")
    expect(src).toContain('generateBankReference()')
  })
})
