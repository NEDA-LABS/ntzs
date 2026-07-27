import { describe, it, expect, afterEach } from 'vitest'

import {
  isTestMode,
  normalizeMode,
  generateTestApiKey,
  testModeSignupEnabled,
  testModeSignupDailyCap,
  settleDelayMs,
  TEST_KEY_PREFIX,
} from './mode'

const ENV_KEYS = ['TESTMODE_SIGNUP_ENABLED', 'TESTMODE_SIGNUP_DAILY_CAP', 'TESTMODE_SETTLE_DELAY_MS'] as const
const saved: Record<string, string | undefined> = {}
for (const k of ENV_KEYS) saved[k] = process.env[k]

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('partner mode', () => {
  it('only the exact string "test" is test mode — anything else is live', () => {
    expect(isTestMode({ mode: 'test' })).toBe(true)
    expect(isTestMode({ mode: 'live' })).toBe(false)
    // Fail SAFE: an unknown/absent/legacy value must never grant test mode…
    expect(isTestMode({ mode: null })).toBe(false)
    expect(isTestMode({})).toBe(false)
    expect(isTestMode({ mode: 'TEST' })).toBe(false)
    expect(isTestMode({ mode: 'testing' })).toBe(false)
    // …and normalizeMode agrees, so a pre-migration row reads as live.
    expect(normalizeMode(undefined)).toBe('live')
    expect(normalizeMode('test')).toBe('test')
  })
})

describe('test API keys', () => {
  it('are prefixed and unguessable', () => {
    const a = generateTestApiKey()
    const b = generateTestApiKey()
    expect(a.startsWith(TEST_KEY_PREFIX)).toBe(true)
    expect(a).toMatch(/^ntzs_test_[0-9a-f]{40}$/)
    expect(a).not.toBe(b)
  })
})

describe('configuration', () => {
  it('self-serve signup is open by default and closed only by an explicit false', () => {
    delete process.env.TESTMODE_SIGNUP_ENABLED
    expect(testModeSignupEnabled()).toBe(true)
    process.env.TESTMODE_SIGNUP_ENABLED = 'true'
    expect(testModeSignupEnabled()).toBe(true)
    process.env.TESTMODE_SIGNUP_ENABLED = 'false'
    expect(testModeSignupEnabled()).toBe(false)
  })

  it('falls back to sane defaults for the daily cap and settle delay', () => {
    delete process.env.TESTMODE_SIGNUP_DAILY_CAP
    expect(testModeSignupDailyCap()).toBe(50)
    process.env.TESTMODE_SIGNUP_DAILY_CAP = 'not-a-number'
    expect(testModeSignupDailyCap()).toBe(50)
    process.env.TESTMODE_SIGNUP_DAILY_CAP = '5'
    expect(testModeSignupDailyCap()).toBe(5)

    delete process.env.TESTMODE_SETTLE_DELAY_MS
    expect(settleDelayMs()).toBe(3000)
    process.env.TESTMODE_SETTLE_DELAY_MS = '0' // CI: settle immediately
    expect(settleDelayMs()).toBe(0)
  })
})
