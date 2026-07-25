import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'

vi.mock('./selcom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./selcom')>()
  return { ...actual, lookupRecipientName: vi.fn() }
})

import * as selcom from './selcom'
import { lookupRecipientName, _resetLookupGuardForTests } from './index'

const selcomLookup = vi.mocked(selcom.lookupRecipientName)

const SAVED = { ...process.env }

beforeAll(() => {
  // Make the Selcom leg "configured" and keep the AzamPay leg off so the
  // chain outcome is determined by the mocked Selcom call alone.
  process.env.SELCOM_API_KEY = 'k'
  process.env.SELCOM_PRIVATE_KEY = 'p'
  process.env.SELCOM_ACCOUNT_NUMBER = 'a'
  delete process.env.ACTIVE_MOBILE_PSP
  delete process.env.AZAMPAY_APP_NAME
  delete process.env.AZAMPAY_CLIENT_ID
  delete process.env.AZAMPAY_CLIENT_SECRET
})

afterAll(() => {
  process.env = SAVED
})

beforeEach(() => {
  _resetLookupGuardForTests()
  selcomLookup.mockReset()
})

describe('lookupRecipientName volume guard (cache + restriction breaker)', () => {
  it('caches a resolved name — the provider is asked once per number', async () => {
    selcomLookup.mockResolvedValue({ name: 'JOHN DOE' })

    expect((await lookupRecipientName('0744277496')).name).toBe('JOHN DOE')
    expect((await lookupRecipientName('0744277496')).name).toBe('JOHN DOE')
    expect(selcomLookup).toHaveBeenCalledTimes(1)
  })

  it('caches misses briefly (repeat asks for the same number are absorbed)', async () => {
    selcomLookup.mockResolvedValue({ name: null, reason: 'http:400 resultcode:642 message:Lookup failed' })

    expect((await lookupRecipientName('0744277496')).name).toBeNull()
    expect((await lookupRecipientName('0744277496')).name).toBeNull()
    expect(selcomLookup).toHaveBeenCalledTimes(1)
  })

  it('an ordinary refusal does NOT trip the breaker — other numbers still query', async () => {
    selcomLookup.mockResolvedValue({ name: null, reason: 'http:400 resultcode:642 message:Lookup failed' })

    await lookupRecipientName('0744277496')
    await lookupRecipientName('0689000000')
    expect(selcomLookup).toHaveBeenCalledTimes(2)
  })

  it('a restriction answer pauses ALL selcom lookups (no hammering a closed door)', async () => {
    selcomLookup.mockResolvedValue({
      name: null,
      reason:
        'http:403 resultcode:n/a message:Lookup access has been temporarily restricted for this credential due to excessive lookup usage.',
    })

    expect((await lookupRecipientName('0744277496')).name).toBeNull()
    // Different number — result cache can't serve it; only the breaker stops the call.
    expect((await lookupRecipientName('0689000000')).name).toBeNull()
    expect(selcomLookup).toHaveBeenCalledTimes(1)
  })
})
