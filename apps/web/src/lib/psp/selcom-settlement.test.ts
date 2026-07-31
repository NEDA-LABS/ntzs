import { describe, it, expect } from 'vitest'

import {
  isUndeliveredUtilityPurchase,
  mergeSettlement,
  readSelcomSettlement,
  selcomFailureReason,
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

/**
 * The live FAILED verdict of 30 Jul 2026 (ref 202607304073), verbatim. The
 * envelope's resultcode/message describe the RETRIEVAL, not the failure —
 * composing payout_error from them produced "Selcom FAILED: 200 Transaction
 * status retrieved.", which reads like a reason and is not one.
 */
const LIVE_FAILED_ENVELOPE = {
  success: true,
  error_code: '000',
  message: 'Transaction status retrieved.',
  result: 'FAIL' as const,
  resultcode: '200',
  data: {
    transId: '202607304073',
    status: 'FAILED',
    amount: '6150.00',
    principalAmount: '6000.00',
    totalCharges: '150.00',
    chargesSummary: '-',
    currency: 'TZS',
    selcomReceipt: '-',
  },
}

describe('selcomFailureReason (misleading evidence is worse than missing evidence)', () => {
  it('returns nothing for the retrieval boilerplate', () => {
    expect(selcomFailureReason(LIVE_FAILED_ENVELOPE)).toBe('')
  })

  it('passes a real dispatch-time verdict through, code included', () => {
    expect(selcomFailureReason({ resultcode: '651', message: 'Insufficient balance' })).toBe(
      '651 Insufficient balance'
    )
  })

  it('drops the query-ok code but keeps a real message', () => {
    expect(selcomFailureReason({ resultcode: '200', message: 'Destination till inactive' })).toBe(
      'Destination till inactive'
    )
  })

  it('returns nothing for an empty envelope', () => {
    expect(selcomFailureReason({})).toBe('')
  })
})

describe('readSelcomSettlement on the live FAILED payload', () => {
  it('reads the charges and keeps the raw verdict', () => {
    const s = readSelcomSettlement(LIVE_FAILED_ENVELOPE.data)
    expect(s.actualChargesTzs).toBe(150)
    expect(s.raw?.transId).toBe('202607304073')
  })
})
