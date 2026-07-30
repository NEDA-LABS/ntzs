import { describe, it, expect } from 'vitest'

import {
  isUndeliveredUtilityPurchase,
  mergeSettlement,
  readSelcomSettlement,
} from './selcom-settlement'

/**
 * The bug this module replaced: two call sites read `d.totalCharges` and
 * `d.selcomReceipt` off a payload that sends `total_charges` and
 * `selcom_receipt`. Both were always undefined, so no spend ever recorded what
 * Selcom actually charged — and for LUKU, the customer's token was dropped
 * entirely (30 July 2026: paid twice, tokens only in our own operator SMS).
 */
describe('readSelcomSettlement', () => {
  it('reads the snake_case payload Selcom actually sends', () => {
    const s = readSelcomSettlement({
      trans_id: '1820982008',
      selcom_receipt: 'SB123ABC',
      total_charges: 47,
      charges_summary: 'Fee 23, VAT 5, Ex Duty 2',
    })
    expect(s.selcomReceipt).toBe('SB123ABC')
    expect(s.actualChargesTzs).toBe(47)
    expect(s.chargesSummary).toBe('Fee 23, VAT 5, Ex Duty 2')
  })

  it('tolerates camelCase too — the convention must never matter again', () => {
    const s = readSelcomSettlement({ totalCharges: '1,047', selcomReceipt: 'SB9' })
    expect(s.actualChargesTzs).toBe(1047)
    expect(s.selcomReceipt).toBe('SB9')
  })

  it('captures the utility token under any of the names vendors use', () => {
    for (const key of ['token', 'utility_token', 'meter_token', 'voucher', 'voucher_code']) {
      const s = readSelcomSettlement({ [key]: '5373 0001 9365 2741 2169' })
      expect(s.utilityToken, `field '${key}' must be recognised as the token`).toBe('5373 0001 9365 2741 2169')
    }
  })

  it('keeps the raw payload so the next wrong guess is diagnosable from a row', () => {
    const payload = { some_field_we_never_predicted: 'x', total_charges: 10 }
    expect(readSelcomSettlement(payload).raw).toEqual(payload)
  })

  it('never throws, whatever arrives — this runs on a money path', () => {
    for (const junk of [null, undefined, 'string', 42, [], { token: null }, { total_charges: 'abc' }]) {
      expect(() => readSelcomSettlement(junk)).not.toThrow()
    }
    expect(readSelcomSettlement({ total_charges: 'abc' }).actualChargesTzs).toBeUndefined()
  })
})

describe('mergeSettlement', () => {
  it('never erases a value we hold with an absent one', () => {
    // A later status query that omits the token must not delete the token an
    // earlier query gave us — that would re-lose the customer's product.
    const descriptor = { kind: 'bill', utilityToken: '1111 2222', selcomReceipt: 'SB1' }
    const merged = mergeSettlement(descriptor, readSelcomSettlement({ total_charges: 47 }))
    expect(merged.utilityToken).toBe('1111 2222')
    expect(merged.selcomReceipt).toBe('SB1')
    expect(merged.actualChargesTzs).toBe(47)
  })

  it('updates when the settlement does carry the field', () => {
    const merged = mergeSettlement({ kind: 'bill' }, readSelcomSettlement({ token: '5373', units: '2.8kWh' }))
    expect(merged.utilityToken).toBe('5373')
    expect(merged.utilityUnits).toBe('2.8kWh')
  })
})

describe('isUndeliveredUtilityPurchase', () => {
  it('flags a settled bill with no token — a paid customer holding nothing', () => {
    expect(isUndeliveredUtilityPurchase({ kind: 'bill' })).toBe(true)
    expect(isUndeliveredUtilityPurchase({ kind: 'bill', utilityToken: '5373' })).toBe(false)
  })

  it('does not flag lipa — a till payment has no voucher to deliver', () => {
    expect(isUndeliveredUtilityPurchase({ kind: 'lipa' })).toBe(false)
  })
})
