import { describe, it, expect } from 'vitest'

import { isMissingSchemaObject, pgErrorCodes } from './db-errors'

/**
 * Regression test for the 27 Jul 2026 incident: the deploy-order fallback in
 * lib/waas/auth.ts inspected only the top-level error, so drizzle's wrapper
 * hid the `42703` on its `.cause` and the fallback never latched. Partner API
 * calls returned 500 for the whole deploy→migration window.
 *
 * `drizzleWrapped` below reproduces the exact shape that shipped.
 */
function drizzleWrapped(cause: unknown): Error {
  // DrizzleQueryError: message is the SQL, never the driver's text.
  const err = new Error(
    'Failed query: select "id", "name", "mode", "live_partner_id" from "partners" where "partners"."api_key_hash" = $1 limit $2\nparams: abc,1'
  )
  ;(err as Error & { cause?: unknown }).cause = cause
  return err
}

function pgError(code: string, message: string): Error {
  const err = new Error(message)
  ;(err as Error & { code?: string }).code = code
  return err
}

describe('isMissingSchemaObject', () => {
  it('sees through drizzle’s wrapper to the SQLSTATE on the cause (the incident)', () => {
    const wrapped = drizzleWrapped(pgError('42703', 'column "mode" does not exist'))
    expect(isMissingSchemaObject(wrapped)).toBe(true)
    // The wrapper alone gives nothing away — this is why the naive check failed.
    expect((wrapped as Error & { code?: string }).code).toBeUndefined()
    expect(/does not exist/i.test(wrapped.message)).toBe(false)
  })

  it('handles a missing table and a nested chain', () => {
    expect(isMissingSchemaObject(drizzleWrapped(pgError('42P01', 'relation "test_mode_users" does not exist')))).toBe(true)
    expect(isMissingSchemaObject(drizzleWrapped(drizzleWrapped(pgError('42703', 'nope'))))).toBe(true)
  })

  it('still recognises an unwrapped driver error', () => {
    expect(isMissingSchemaObject(pgError('42703', 'column "mode" does not exist'))).toBe(true)
  })

  it('falls back to the message when no SQLSTATE is present', () => {
    expect(isMissingSchemaObject(drizzleWrapped(new Error('column "mode" does not exist')))).toBe(true)
  })

  it('does NOT swallow unrelated failures — the fallback must stay narrow', () => {
    expect(isMissingSchemaObject(drizzleWrapped(pgError('23505', 'duplicate key value violates unique constraint'))))
      .toBe(false)
    expect(isMissingSchemaObject(drizzleWrapped(pgError('57014', 'canceling statement due to statement timeout')))).toBe(false)
    expect(isMissingSchemaObject(new Error('connection terminated unexpectedly'))).toBe(false)
    expect(isMissingSchemaObject(null)).toBe(false)
    expect(isMissingSchemaObject(undefined)).toBe(false)
    // A query that merely mentions a column named "does not exist" style text
    // in its SQL must not trip the message fallback on its own.
    expect(isMissingSchemaObject(new Error('Failed query: select "mode" from "partners"'))).toBe(false)
  })

  it('terminates on a cyclic cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown }
    const b = new Error('b') as Error & { cause?: unknown }
    a.cause = b
    b.cause = a
    expect(() => isMissingSchemaObject(a)).not.toThrow()
    expect(isMissingSchemaObject(a)).toBe(false)
  })
})

describe('pgErrorCodes', () => {
  it('collects every SQLSTATE in the chain', () => {
    expect(pgErrorCodes(drizzleWrapped(pgError('42703', 'x')))).toEqual(['42703'])
    expect(pgErrorCodes(new Error('plain'))).toEqual([])
  })
})
