import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import {
  ATTESTED_ID_TYPES,
  MAX_ATTESTATION_AGE_DAYS,
  formatAttestationEvidence,
  normalizeIdentityKey,
  parseAttestation,
} from './attestation'
import { kycDisplayName } from './display'

/**
 * Partner-attested KYC lets a partner's own verification approve one of our
 * cases and issue a wallet. That is delegation of a regulatory control, so
 * these tests are about the CONTROL — who may attest, what an attestation must
 * be able to prove, and what it may never do — rather than about shape.
 */

const NOW = new Date('2026-08-05T12:00:00Z')

const VALID = {
  decision: 'approved',
  country: 'KE',
  idType: 'PASSPORT',
  idNumber: 'A1234567',
  fullName: 'Jane Wanjiru Doe',
  reference: 'NEDAPAY-KYC-88213',
  verifiedBy: 'compliance@nedapay.xyz',
  verifiedAt: '2026-08-04T09:30:00Z',
}

const ok = (input: Record<string, unknown>) => parseAttestation(input, NOW)

describe('an attestation must be able to answer the regulator', () => {
  it('accepts one that names the verifier, the moment, and the document', () => {
    const result = ok(VALID)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.decision).toBe('approved')
    expect(result.value.idNumber).toBe('A1234567')
    expect(result.value.verifiedAt.toISOString()).toBe('2026-08-04T09:30:00.000Z')
  })

  it.each([
    ['reference', 'reference_required'],
    ['verifiedBy', 'verified_by_required'],
    ['verifiedAt', 'verified_at_required'],
    ['country', 'invalid_country'],
    ['idType', 'invalid_id_type'],
    ['idNumber', 'invalid_id_number'],
    ['fullName', 'invalid_full_name'],
  ])('refuses an approval with no %s', (field, code) => {
    const result = ok({ ...VALID, [field]: undefined })
    expect(result.ok, `${field} must be mandatory on an approval`).toBe(false)
    if (result.ok) return
    expect(result.code).toBe(code)
  })

  it('refuses a document type outside the agreed list', () => {
    const result = ok({ ...VALID, idType: 'LIBRARY_CARD' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_id_type')
    // The error names the acceptable values, so an integrator can fix it.
    for (const t of ATTESTED_ID_TYPES) expect(result.error).toContain(t)
  })

  it('refuses a single-word name — that is not an identity', () => {
    expect(ok({ ...VALID, fullName: 'Jane' }).ok).toBe(false)
  })
})

describe('a verification has a shelf life', () => {
  it('refuses a verification dated in the future', () => {
    const result = ok({ ...VALID, verifiedAt: '2026-09-01T00:00:00Z' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('verified_at_future')
  })

  it('tolerates a partner clock a couple of minutes ahead', () => {
    expect(ok({ ...VALID, verifiedAt: '2026-08-05T12:02:00Z' }).ok).toBe(true)
  })

  it(`refuses a decision older than ${MAX_ATTESTATION_AGE_DAYS} days rather than replaying it`, () => {
    const stale = new Date(NOW.getTime() - (MAX_ATTESTATION_AGE_DAYS + 2) * 86_400_000).toISOString()
    const result = ok({ ...VALID, verifiedAt: stale })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('verified_at_stale')
  })

  it('accepts one just inside the window', () => {
    const fresh = new Date(NOW.getTime() - (MAX_ATTESTATION_AGE_DAYS - 1) * 86_400_000).toISOString()
    expect(ok({ ...VALID, verifiedAt: fresh }).ok).toBe(true)
  })
})

describe('rejections', () => {
  it('need a reason the customer can act on', () => {
    const result = ok({ ...VALID, decision: 'rejected', notes: undefined })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('notes_required')
  })

  it('do NOT need a document — an unusable document is itself the reason', () => {
    const result = ok({
      decision: 'rejected',
      country: 'KE',
      reference: 'NEDAPAY-KYC-99',
      verifiedBy: 'compliance@nedapay.xyz',
      verifiedAt: '2026-08-04T09:30:00Z',
      notes: 'Document expired in 2021; customer asked to re-submit.',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.idNumber).toBeNull()
  })
})

describe('identity comparison must not merge two different people', () => {
  it('keeps passports apart that differ only by their letter', () => {
    // A digits-only key (what the NIDA paths use) would collapse these two to
    // "1234567" and refuse the second person as a duplicate of the first.
    expect(normalizeIdentityKey('A1234567')).not.toBe(normalizeIdentityKey('B1234567'))
  })

  it('treats formatting differences as the same identity', () => {
    expect(normalizeIdentityKey('a-123 456')).toBe(normalizeIdentityKey('A123456'))
  })

  it('agrees with the digit-strip used by the NIDA paths on an all-digit id', () => {
    const nida = '1990-0101-12345-67890'
    expect(normalizeIdentityKey(nida)).toBe(nida.replace(/\D/g, ''))
  })
})

describe('evidence', () => {
  const attested = ok(VALID)

  it('records who verified, when, against what, under whose reference', () => {
    expect(attested.ok).toBe(true)
    if (!attested.ok) return
    const evidence = formatAttestationEvidence(attested.value, 'NEDApay')
    expect(evidence).toContain('NEDApay')
    expect(evidence).toContain('compliance@nedapay.xyz')
    expect(evidence).toContain('NEDAPAY-KYC-88213')
    expect(evidence).toContain('PASSPORT A1234567')
    expect(evidence).toContain('2026-08-04T09:30:00.000Z')
  })

  it('displays the attested holder by name in Backstage, like a Selcom-verified one', () => {
    if (!attested.ok) return
    const evidence = formatAttestationEvidence(attested.value, 'NEDApay')
    expect(kycDisplayName({ reviewReason: evidence, declaredName: null, email: 'jane@example.com' })).toBe('Jane Wanjiru Doe')
  })

  it('still reads a Selcom NIDA holder name (the older prefix)', () => {
    expect(
      kycDisplayName({ reviewReason: 'NIDA holder: ASHA JUMA MRISHO · Selcom pair verified', declaredName: null, email: 'a@b.c' })
    ).toBe('ASHA JUMA MRISHO')
  })
})

describe('the guarantees that make attested KYC safe to expose', () => {
  const WEB = path.join(__dirname, '../..')
  const read = (p: string) => fs.readFileSync(path.join(WEB, p), 'utf8')
  const ROUTE = 'app/api/v1/users/[id]/kyc/attestation/route.ts'

  it('an API key alone cannot approve an identity — reliance is checked first', () => {
    const src = read(ROUTE)
    expect(src).toContain('getKycReliance')
    expect(src).toContain('kyc_reliance_not_granted')
    // The gate must precede reading the body and looking the user up, so an
    // ungranted partner cannot probe which user ids exist.
    const gate = src.indexOf('kyc_reliance_not_granted')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(src.indexOf('request.json()'))
    expect(gate).toBeLessThan(src.indexOf('partnerUsers.userId, userId'))
  })

  it('reliance is off until someone grants it', () => {
    const migration = fs.readFileSync(path.join(WEB, '../../../drizzle/0076_kyc_partner_attestation.sql'), 'utf8')
    expect(migration).toMatch(/kyc_attestation_enabled boolean NOT NULL DEFAULT false/i)
    // And a deployment missing the column must read as "not granted", never as granted.
    expect(read('lib/kyc/reliance.ts')).toContain('return NOT_GRANTED')
  })

  it('a partner may not contradict or duplicate an identity we already hold', () => {
    const src = read(ROUTE)
    expect(src).toContain('identity_mismatch')
    expect(src).toContain('identity_already_registered')
  })

  it('compares like with like — a passport number is not a mismatched NIDA', () => {
    // A Tanzanian who signed up with a NIDA and was later verified on their
    // passport must not be refused for the numbers differing; they should.
    const src = read(ROUTE)
    expect(src).toContain('heldIdType')
    expect(src).toContain('heldIdType === attestation.idType')
  })

  it('a scoped user check keeps one partner out of another partner’s users', () => {
    expect(read(ROUTE)).toContain('eq(partnerUsers.partnerId, partner.id)')
  })

  it('every attestation is attributable in the audit log', () => {
    const src = read(ROUTE)
    expect(src).toContain('kyc.attested.')
    for (const field of ['reference', 'verifiedBy', 'verifiedAt', 'partnerId']) {
      expect(src, `audit metadata must carry ${field}`).toContain(`${field}:`)
    }
  })
})

describe('approval issues the wallet — there is no second queue', () => {
  const WEB = path.join(__dirname, '../..')
  const read = (p: string) => fs.readFileSync(path.join(WEB, p), 'utf8')

  it('the KYC check lives inside the provisioner, not at its call sites', () => {
    const src = read('lib/waas/provision-wallet.ts')
    expect(src).toContain("latestCase?.status !== 'approved'")
    expect(src).toContain('kyc_not_approved')
  })

  it('a Backstage approval provisions the wallet', () => {
    const src = read('app/backstage/kyc/page.tsx')
    expect(src).toContain('provisionWalletForApprovedUser')
    expect(src).toContain("status === 'approved'")
  })

  it('an attestation approval provisions the wallet', () => {
    expect(read('app/api/v1/users/[id]/kyc/attestation/route.ts')).toContain('provisionWalletForApprovedUser')
  })

  it('re-attesting an already-approved user is idempotent and still returns the wallet', () => {
    const src = read('app/api/v1/users/[id]/kyc/attestation/route.ts')
    expect(src).toContain('alreadyVerified: true')
  })
})

describe('the document-capture vendor is fully removed', () => {
  // Built at runtime so this file does not match its own scan.
  const NEEDLE = ['smile', 'id'].join('')
  const SRC = path.join(__dirname, '../..')

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
    }
    return out
  }

  it('leaves no code, import, or env var behind', () => {
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith('attestation.test.ts'))
      .filter((f) => fs.readFileSync(f, 'utf8').toLowerCase().includes(NEEDLE))
      .map((f) => path.relative(SRC, f))
    expect(offenders, `still referenced in: ${offenders.join(', ')}`).toEqual([])
  })

  it('answers a retired capture-session call with a pointer, not a 404', () => {
    const src = fs.readFileSync(path.join(SRC, 'app/api/v1/users/[id]/kyc/session/route.ts'), 'utf8')
    expect(src).toContain('410')
    expect(src).toContain('endpoint_retired')
    expect(src).toContain('kyc/attestation')
  })
})
