import { describe, it, expect, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

import { isAuthorizedCron } from './cron-auth'

/** Minimal NextRequest stand-in exposing a case-insensitive headers.get(). */
function reqWith(headers: Record<string, string>): NextRequest {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as NextRequest
}

describe('isAuthorizedCron (C3 — fail-closed cron auth)', () => {
  const original = process.env.CRON_SECRET
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = original
  })

  it('fails CLOSED when CRON_SECRET is unset (regression: fail-open)', () => {
    delete process.env.CRON_SECRET
    expect(isAuthorizedCron(reqWith({ authorization: 'Bearer anything' }))).toBe(false)
    expect(isAuthorizedCron(reqWith({}))).toBe(false)
  })

  it('accepts the correct Bearer token', () => {
    process.env.CRON_SECRET = 'super-secret-value-123'
    expect(isAuthorizedCron(reqWith({ authorization: 'Bearer super-secret-value-123' }))).toBe(true)
  })

  it('rejects a wrong or missing token', () => {
    process.env.CRON_SECRET = 'super-secret-value-123'
    expect(isAuthorizedCron(reqWith({ authorization: 'Bearer wrong' }))).toBe(false)
    expect(isAuthorizedCron(reqWith({ authorization: 'super-secret-value-123' }))).toBe(false)
    expect(isAuthorizedCron(reqWith({}))).toBe(false)
  })

  it('does NOT honour the spoofable x-vercel-cron header (regression: C3)', () => {
    process.env.CRON_SECRET = 'super-secret-value-123'
    expect(isAuthorizedCron(reqWith({ 'x-vercel-cron': '1' }))).toBe(false)
    expect(isAuthorizedCron(reqWith({ 'x-vercel-cron': '1', authorization: 'Bearer wrong' }))).toBe(false)
  })
})
