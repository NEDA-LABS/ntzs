import { describe, it, expect } from 'vitest'

import { computeSelcomDigest, normalizeNidaNumber, interpretSelcomResponse } from './selcom'

describe('computeSelcomDigest (Selcom api_digest scheme)', () => {
  it('is SHA-256(api_key + api_secret) as lowercase hex', () => {
    // Known vector: sha256("keysecret") — matches Selcom's Postman prerequest script.
    expect(computeSelcomDigest('key', 'secret')).toBe(
      'd6ff67573947d391ee2589b6a3534a3b300a1c6105acd079b9745b37bd9e4260'
    )
    expect(computeSelcomDigest('key', 'secret')).toMatch(/^[0-9a-f]{64}$/)
    // Order-sensitive: digest(key,secret) !== digest(secret,key)
    expect(computeSelcomDigest('key', 'secret')).not.toBe(computeSelcomDigest('secret', 'key'))
  })
})

describe('normalizeNidaNumber', () => {
  it('accepts the standard dashed format and strips to 20 digits', () => {
    expect(normalizeNidaNumber('19990102-61401-00001-20')).toBe('19990102614010000120')
  })

  it('accepts plain 20 digits', () => {
    expect(normalizeNidaNumber('19990102614010000120')).toBe('19990102614010000120')
  })

  it('rejects wrong lengths and non-digits', () => {
    expect(normalizeNidaNumber('1234')).toBeNull()
    expect(normalizeNidaNumber('19990102-61401-00001-2X')).toBeNull()
    expect(normalizeNidaNumber('')).toBeNull()
  })
})

describe('interpretSelcomResponse (fail-closed verification)', () => {
  it('verifies on explicit success with a record (resultcode 000)', () => {
    const r = interpretSelcomResponse(200, {
      resultcode: '000',
      result: 'SUCCESS',
      message: 'ok',
      data: [{ firstname: 'Asha', middlename: 'J', surname: 'Mrisho', reference: 'REF1' }],
    })
    expect(r.status).toBe('verified')
    if (r.status === 'verified') {
      expect(r.fullName).toBe('Asha J Mrisho')
      expect(r.reference).toBe('REF1')
    }
  })

  it('verifies when the record is a plain data object', () => {
    const r = interpretSelcomResponse(200, { result: 'SUCCESS', data: { first_name: 'Juma', last_name: 'K' } })
    expect(r.status).toBe('verified')
  })

  it('returns not_found on explicit failure', () => {
    const r = interpretSelcomResponse(200, { result: 'FAIL', resultcode: '404', message: 'No record' })
    expect(r.status).toBe('not_found')
  })

  it('returns not_found on success with an empty record set', () => {
    expect(interpretSelcomResponse(200, { result: 'SUCCESS', data: [] }).status).toBe('not_found')
  })

  it('matches keys case-insensitively (Result/Data/FirstName variants)', () => {
    const r = interpretSelcomResponse(200, {
      Result: 'SUCCESS',
      ResponseCode: '000',
      Data: [{ FirstName: 'Neema', Surname: 'Kihoro' }],
    })
    expect(r.status).toBe('verified')
    if (r.status === 'verified') expect(r.fullName).toBe('Neema Kihoro')
  })

  it('accepts a success:true boolean with a user_data record', () => {
    expect(interpretSelcomResponse(200, { success: true, user_data: { first_name: 'A', last_name: 'B' } }).status).toBe('verified')
  })

  it('treats success:false as not_found', () => {
    expect(interpretSelcomResponse(200, { success: false, message: 'no match' }).status).toBe('not_found')
  })

  it('NEVER verifies on ambiguous shapes (fail closed)', () => {
    expect(interpretSelcomResponse(200, { hello: 'world' }).status).toBe('unavailable')
    expect(interpretSelcomResponse(200, null).status).toBe('unavailable')
    expect(interpretSelcomResponse(500, { result: 'SUCCESS', data: [{ firstname: 'X' }] }).status).toBe('unavailable')
  })
})
