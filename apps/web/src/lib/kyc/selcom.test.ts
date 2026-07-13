import { describe, it, expect } from 'vitest'

import { computeSelcomDigest, normalizeNidaNumber, toSelcomMobileNumber, interpretSelcomResponse } from './selcom'

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

describe('toSelcomMobileNumber (9 significant digits — probed contract)', () => {
  it('strips local, international and formatted prefixes to 9 digits', () => {
    expect(toSelcomMobileNumber('0744000001')).toBe('744000001')
    expect(toSelcomMobileNumber('255744000001')).toBe('744000001')
    expect(toSelcomMobileNumber('+255 766 000 002')).toBe('766000002')
    expect(toSelcomMobileNumber('744000001')).toBe('744000001')
    expect(toSelcomMobileNumber('0629-000-003')).toBe('629000003')
  })

  it('rejects short, empty, and non-mobile numbers', () => {
    expect(toSelcomMobileNumber('12345')).toBeNull()
    expect(toSelcomMobileNumber('')).toBeNull()
    // Dar landline: last 9 digits start with 2, not a mobile range
    expect(toSelcomMobileNumber('0222110110')).toBeNull()
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

  it('verifies the LIVE Selcom Identity shape (status_code + response array)', () => {
    const r = interpretSelcomResponse(200, {
      status_code: 200,
      message: 'User data fetched successful',
      response: [{ first_name: 'Asha', middle_name: 'J', sur_name: 'Mrisho', surname: 'Mrisho' }],
      app_data: { requestid: 'x' },
    })
    expect(r.status).toBe('verified')
    if (r.status === 'verified') expect(r.fullName).toContain('Asha')
  })

  it('treats live-shape empty response as not_found', () => {
    expect(
      interpretSelcomResponse(200, { status_code: 200, message: 'No record found', response: [], app_data: {} }).status
    ).toBe('not_found')
  })

  it('treats live-shape non-200 status_code as not_found', () => {
    expect(
      interpretSelcomResponse(200, { status_code: 404, message: 'Not found', response: [], app_data: {} }).status
    ).toBe('not_found')
  })

  it('NEVER verifies on ambiguous shapes (fail closed)', () => {
    expect(interpretSelcomResponse(200, { hello: 'world' }).status).toBe('unavailable')
    expect(interpretSelcomResponse(200, null).status).toBe('unavailable')
    expect(interpretSelcomResponse(500, { result: 'SUCCESS', data: [{ firstname: 'X' }] }).status).toBe('unavailable')
  })
})

describe('interpretSelcomResponse — pair contract shapes probed live on 13 Jul 2026', () => {
  it('verifies the pair-success shape (response as OBJECT, numeric mobile_number echo)', () => {
    const r = interpretSelcomResponse(200, {
      status_code: 200,
      message: 'Data is fetched Successfully',
      response: {
        first_name: 'ASHA',
        last_name: 'MRISHO',
        middle_name: 'JUMA',
        nida_number: '19990102-61401-00001-20',
        mobile_number: 744000001,
        country_code: '255',
        gender: 'FEMALE',
        nationality: 'TANZANIAN',
      },
      app_data: { version: {}, access_token: '' },
    })
    expect(r.status).toBe('verified')
    if (r.status === 'verified') expect(r.fullName).toBe('ASHA JUMA MRISHO')
  })

  it('maps the pair-mismatch message to mismatch (phone belongs to someone else)', () => {
    const r = interpretSelcomResponse(200, {
      message: 'Mobile number does not match with the NIDA number.',
      status_code: 400,
      app_data: {},
    })
    expect(r.status).toBe('mismatch')
  })

  it('maps "NIDA number is not found!" to not_found (incl. genuine non-Selcom-Pesa users)', () => {
    const r = interpretSelcomResponse(200, {
      message: 'NIDA number is not found!',
      status_code: 400,
      app_data: {},
    })
    expect(r.status).toBe('not_found')
  })

  it('maps request-validation complaints to unavailable, never an identity verdict', () => {
    const r = interpretSelcomResponse(200, {
      status_code: 400,
      message: '"mobile_number" is required',
      app_data: {},
    })
    expect(r.status).toBe('unavailable')
  })
})
