import { describe, it, expect } from 'vitest'
import { createHash, generateKeyPairSync, privateDecrypt, constants } from 'node:crypto'

import {
  buildNameLookupChecksumInput,
  buildDisbursementChecksumInput,
  computeAzamPayChecksum,
  azamPayChecksumKey,
  azamBankNameForNetwork,
} from './azampay-checksum'

describe('checksum input strings (must match AzamPay sample code exactly)', () => {
  it('name lookup: bankName + accountNumber', () => {
    expect(buildNameLookupChecksumInput('Azampesa', '1710446004')).toBe('Azampesa1710446004')
  })

  it('disbursement: sourceAcc + destAcc + currency + amount + epoch + externalReferenceId', () => {
    expect(
      buildDisbursementChecksumInput({
        sourceAcc: '1000000164',
        destAcc: '1710446004',
        currency: 'TZS',
        amount: '1000',
        epochSeconds: 1752678000,
        externalReferenceId: 'NtpK4mZrT7xQdH2vLs9WcJ5aBy',
      })
    ).toBe('10000001641710446004TZS10001752678000NtpK4mZrT7xQdH2vLs9WcJ5aBy')
  })
})

describe('computeAzamPayChecksum (SHA-512 → RSA PKCS#1 → base64)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  it('produces base64 ciphertext that decrypts to the SHA-512 of the input', () => {
    const input = 'Azampesa1710446004'
    const checksum = computeAzamPayChecksum(input, publicPem)

    const decrypted = privateDecrypt(
      { key: privatePem, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(checksum, 'base64')
    )
    const expected = createHash('sha512').update(input, 'utf8').digest()
    expect(decrypted.equals(expected)).toBe(true)
  })
})

describe('azamPayChecksumKey', () => {
  it('decodes a base64-encoded PEM and rejects garbage', () => {
    const pem = '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----\n'
    const env = { AZAMPAY_CHECKSUM_PUBLIC_KEY_B64: Buffer.from(pem).toString('base64') }
    expect(azamPayChecksumKey(env)).toBe(pem)
    expect(azamPayChecksumKey({})).toBeNull()
    expect(azamPayChecksumKey({ AZAMPAY_CHECKSUM_PUBLIC_KEY_B64: 'not-a-pem' })).toBeNull()
  })
})

describe('azamBankNameForNetwork (AzamPay destination vocabulary)', () => {
  it('maps detected networks to their exact bankName strings', () => {
    expect(azamBankNameForNetwork('vodacom')).toBe('Vodacom')
    expect(azamBankNameForNetwork('airtel')).toBe('Airtel')
    expect(azamBankNameForNetwork('tigo')).toBe('Yas') // Tigo Pesa is Mixx by Yas
    expect(azamBankNameForNetwork('halotel')).toBe('Halotel')
    expect(azamBankNameForNetwork('ttcl')).toBe('Tpesa')
  })
})
