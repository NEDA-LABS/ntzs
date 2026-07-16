/**
 * AzamPay production checksums — per their sample code (16 Jul 2026):
 *
 *   checksum = base64( RSA_PKCS1_encrypt( publicKey, SHA512(inputString) ) )
 *
 * Input strings:
 *   name lookup:   bankName + accountNumber
 *   disbursement:  sourceAcc + destAcc + currency + amount + epochSeconds + externalReferenceId
 *
 * The RSA public key is provided by AzamPay as a PEM file (test:
 * responsetest.pem; production key arrives with production credentials) and
 * is configured as base64-encoded PEM in AZAMPAY_CHECKSUM_PUBLIC_KEY_B64.
 * Pure functions — unit tested by round-trip decryption.
 */
import { createHash, publicEncrypt, constants } from 'node:crypto'

export function buildNameLookupChecksumInput(bankName: string, accountNumber: string): string {
  return `${bankName}${accountNumber}`
}

export function buildDisbursementChecksumInput(p: {
  sourceAcc: string
  destAcc: string
  currency: string
  /** Whole-number string, e.g. '1000' — matches AzamPay's sample. */
  amount: string
  epochSeconds: number
  externalReferenceId: string
}): string {
  return `${p.sourceAcc}${p.destAcc}${p.currency}${p.amount}${p.epochSeconds}${p.externalReferenceId}`
}

export function computeAzamPayChecksum(input: string, publicKeyPem: string): string {
  const digest = createHash('sha512').update(input, 'utf8').digest()
  const encrypted = publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
    digest
  )
  return encrypted.toString('base64')
}

/** Decode the configured PEM (base64 env value) — null when not configured. */
export function azamPayChecksumKey(env: Record<string, string | undefined> = process.env): string | null {
  const b64 = env.AZAMPAY_CHECKSUM_PUBLIC_KEY_B64
  if (!b64) return null
  try {
    const pem = Buffer.from(b64, 'base64').toString('utf8')
    return pem.includes('BEGIN') ? pem : null
  } catch {
    return null
  }
}

/**
 * AzamPay's destination bankName vocabulary (their integration Q&A, item 6):
 * routing is by destination bankName — Yas | Airtel | Vodacom | Azampesa |
 * Halotel | Tpesa. Maps our detected network to their exact strings.
 */
export function azamBankNameForNetwork(
  network: 'vodacom' | 'airtel' | 'tigo' | 'halotel' | 'ttcl' | 'unknown'
): string {
  switch (network) {
    case 'vodacom':
      return 'Vodacom'
    case 'airtel':
      return 'Airtel'
    case 'tigo':
      return 'Yas'
    case 'halotel':
      return 'Halotel'
    case 'ttcl':
      return 'Tpesa'
    case 'unknown':
      return 'Azampesa'
  }
}
