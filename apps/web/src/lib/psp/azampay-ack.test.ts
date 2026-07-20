import { describe, it, expect } from 'vitest'

import { extractAzamTransactionId } from './azampay'

describe('extractAzamTransactionId (checkout acknowledgment id capture)', () => {
  it('finds the id at top level, any casing', () => {
    expect(extractAzamTransactionId({ success: true, transactionId: 'AZM019f74c8' })).toBe('AZM019f74c8')
    expect(extractAzamTransactionId({ TransactionID: '260718Ehg' })).toBe('260718Ehg')
    expect(extractAzamTransactionId({ transaction_id: 'abc123' })).toBe('abc123')
  })

  it('finds the id nested inside wrappers (data/properties)', () => {
    expect(extractAzamTransactionId({ success: true, data: { transactionId: '019f7697a03e' } })).toBe('019f7697a03e')
    expect(
      extractAzamTransactionId({ data: { properties: { TransactionId: 'AZMnested1' } } })
    ).toBe('AZMnested1')
  })

  it('ignores empty and literal-null values, returns undefined when absent', () => {
    expect(extractAzamTransactionId({ transactionId: 'null' })).toBeUndefined()
    expect(extractAzamTransactionId({ transactionId: '  ' })).toBeUndefined()
    expect(extractAzamTransactionId({ success: true, message: 'ok' })).toBeUndefined()
    expect(extractAzamTransactionId(null)).toBeUndefined()
    expect(extractAzamTransactionId('string')).toBeUndefined()
  })

  it('does not confuse other id fields for the transaction id', () => {
    expect(extractAzamTransactionId({ externalId: 'uuid-1', referenceId: 'r1' })).toBeUndefined()
  })
})
