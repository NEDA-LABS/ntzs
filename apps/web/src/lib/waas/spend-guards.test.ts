import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import { DUPLICATE_WINDOW_MS, duplicateSpendResponse } from './spend-duplicate'

/**
 * Guards born from the 30 July 2026 LUKU incident: a payment succeeded while
 * the request died in transport, the client showed "Payment failed", and the
 * customer retried and paid twice — then never received either token.
 */

describe('duplicateSpendResponse', () => {
  const match = {
    burnRequestId: 'b-1',
    reference: '1820904138',
    payoutStatus: 'completed',
    createdAt: new Date(Date.now() - 90_000),
    spend: {
      utilityToken: '5373 0001 9365 2741 2169',
      utilityUnits: '2.8kWh',
      selcomReceipt: 'SB1',
    } as Record<string, unknown>,
  }

  it('carries the original transaction, token included, so the client can make the customer whole', () => {
    const body = duplicateSpendResponse(match)
    expect(body.error).toBe('duplicate_spend')
    expect(body.existing.reference).toBe('1820904138')
    // The token is what the customer actually needs — a 409 that names the
    // duplicate but withholds the voucher still ends in a support ticket.
    expect(body.existing.utilityToken).toBe('5373 0001 9365 2741 2169')
    expect(body.existing.utilityUnits).toBe('2.8kWh')
  })

  it('explains the deliberate path rather than dead-ending the client', () => {
    expect(duplicateSpendResponse(match).message).toContain('allowDuplicate')
  })

  it('omits token fields it does not have rather than sending nulls', () => {
    const body = duplicateSpendResponse({ ...match, spend: null })
    expect('utilityToken' in body.existing).toBe(false)
  })

  it('window is long enough for a timeout-retry, short enough for real repeat purchases', () => {
    expect(DUPLICATE_WINDOW_MS).toBe(5 * 60 * 1000)
  })
})

/**
 * Source-level guards: these hold the route to the incident's lessons, so a
 * refactor cannot quietly reintroduce the failure shape.
 */
describe('the spend route cannot regress to the incident shape', () => {
  const route = fs.readFileSync(path.join(__dirname, '../../app/api/v1/spend/route.ts'), 'utf8')
  const dispatch = fs.readFileSync(path.join(__dirname, 'spend-dispatch.ts'), 'utf8')

  it('checks for a duplicate BEFORE creating the burn row', () => {
    const dupAt = route.indexOf('findDuplicateSpend')
    const burnAt = route.indexOf('.insert(burnRequests)')
    expect(dupAt).toBeGreaterThan(-1)
    expect(burnAt).toBeGreaterThan(-1)
    // Past the burn, a duplicate is a refund conversation, not a prevented
    // mistake — the guard is only worth having on this side of it.
    expect(dupAt).toBeLessThan(burnAt)
  })

  it('bounds the awaited poll by the request budget', () => {
    expect(route).toContain('RESPONSE_BUDGET_MS')
    expect(route).toContain('pollDeadlineMs: startedAt + RESPONSE_BUDGET_MS')
    // The budget must leave the platform limit headroom to actually respond.
    const budget = Number(route.match(/RESPONSE_BUDGET_MS = (\d+)_000/)?.[1])
    const maxDuration = Number(route.match(/maxDuration = (\d+)/)?.[1])
    expect(budget).toBeLessThan(maxDuration)
  })

  it('the dispatch poll gives up when the deadline would be crossed', () => {
    expect(dispatch).toContain('pollDeadlineMs')
    expect(dispatch).toMatch(/Date\.now\(\) \+ delay > deadline/)
  })

  it('reads settlements through the tolerant reader, not hand-rolled keys', () => {
    // d.totalCharges / d.selcomReceipt against a snake_case payload was the
    // bug that dropped every token and receipt. The reader owns naming now.
    expect(dispatch).toContain('readSelcomSettlement')
    expect(dispatch).not.toMatch(/d\?\.totalCharges|d\?\.selcomReceipt/)
    const cron = fs.readFileSync(
      path.join(__dirname, '../../app/api/cron/spend-status-sync/route.ts'),
      'utf8'
    )
    expect(cron).toContain('readSelcomSettlement')
    expect(cron).not.toMatch(/d\?\.totalCharges|d\?\.selcomReceipt/)
  })

  it('the duplicate guard fails open — it prevents a mistake, it does not authorise', () => {
    const guard = route.slice(route.indexOf('findDuplicateSpend') - 400, route.indexOf('.insert(burnRequests)'))
    expect(guard).toContain('catch')
    expect(guard).toMatch(/proceeding/i)
  })

  it('a spend can be retrieved without re-executing it', () => {
    const getRoute = path.join(__dirname, '../../app/api/v1/spend/[id]/route.ts')
    expect(fs.existsSync(getRoute)).toBe(true)
    const src = fs.readFileSync(getRoute, 'utf8')
    expect(src).toContain('utilityToken')
    // Tenant scoping: the descriptor's own partnerId, 404 on foreign ids.
    expect(src).toContain("spend.partnerId !== partner.id")
  })
})
