import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  computeSmileIdWebhookSignature,
  interpretSmileIdResult,
  isSmileIdConfigured,
  supportsEnhancedKyc,
  verifySmileIdWebhookSignature,
} from './smileid'

const TS = '2026-07-22T10:00:00.000Z'
const TS_MS = Date.parse(TS)
const PARTNER_ID = '2423'
const API_KEY = 'test-api-key'
// Pinned vector: base64(HMAC-SHA256('test-api-key', TS + '2423' + 'sid_request')).
const PINNED_SIGNATURE = '1TzKvsGTilgKK6eODGzBG/b/h3cTp0NvSPcRWggYfGc='

function stubSmileIdEnv() {
  vi.stubEnv('SMILEID_PARTNER_ID', PARTNER_ID)
  vi.stubEnv('SMILEID_API_KEY', API_KEY)
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('computeSmileIdWebhookSignature', () => {
  it("matches the documented scheme: HMAC(api_key, timestamp + partner_id + 'sid_request')", () => {
    expect(computeSmileIdWebhookSignature(TS, PARTNER_ID, API_KEY)).toBe(PINNED_SIGNATURE)
  })
})

describe('verifySmileIdWebhookSignature — fail-closed', () => {
  it('accepts a valid signature inside the freshness window', () => {
    stubSmileIdEnv()
    expect(
      verifySmileIdWebhookSignature({ signature: PINNED_SIGNATURE, timestamp: TS, nowMs: TS_MS + 60_000 })
    ).toBe(true)
  })

  it('rejects a wrong signature', () => {
    stubSmileIdEnv()
    expect(
      verifySmileIdWebhookSignature({
        signature: PINNED_SIGNATURE.slice(0, -2) + 'A=',
        timestamp: TS,
        nowMs: TS_MS + 60_000,
      })
    ).toBe(false)
  })

  it('rejects a signature of a different length without throwing', () => {
    stubSmileIdEnv()
    expect(verifySmileIdWebhookSignature({ signature: 'short', timestamp: TS, nowMs: TS_MS + 60_000 })).toBe(false)
  })

  it('rejects a stale timestamp (>15 min old)', () => {
    stubSmileIdEnv()
    expect(
      verifySmileIdWebhookSignature({ signature: PINNED_SIGNATURE, timestamp: TS, nowMs: TS_MS + 16 * 60_000 })
    ).toBe(false)
  })

  it('rejects a future timestamp beyond clock skew (>5 min ahead)', () => {
    stubSmileIdEnv()
    expect(
      verifySmileIdWebhookSignature({ signature: PINNED_SIGNATURE, timestamp: TS, nowMs: TS_MS - 6 * 60_000 })
    ).toBe(false)
  })

  it('rejects an unparsable timestamp', () => {
    stubSmileIdEnv()
    expect(
      verifySmileIdWebhookSignature({ signature: PINNED_SIGNATURE, timestamp: 'not-a-date', nowMs: TS_MS })
    ).toBe(false)
  })

  it('rejects everything when credentials are not configured', () => {
    expect(isSmileIdConfigured()).toBe(false)
    expect(
      verifySmileIdWebhookSignature({ signature: PINNED_SIGNATURE, timestamp: TS, nowMs: TS_MS + 60_000 })
    ).toBe(false)
  })

  it('rejects missing headers', () => {
    stubSmileIdEnv()
    expect(verifySmileIdWebhookSignature({ signature: null, timestamp: TS, nowMs: TS_MS })).toBe(false)
    expect(verifySmileIdWebhookSignature({ signature: PINNED_SIGNATURE, timestamp: null, nowMs: TS_MS })).toBe(false)
  })
})

function resultPayload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    status: 'clear',
    message: 'Verification successful',
    reason: null,
    product: 'document_verification',
    partner_params: { kyc_case_id: 'case-123' },
    kyc_receipt: 'https://example.com/receipt.pdf',
    id_fields: {
      first_name: 'Amina',
      other_names: 'Fatou',
      last_name: 'Clearwater',
      full_name: 'Amina Fatou Clearwater',
      id_number: '00000000000',
      country: 'KE',
      id_type: 'PASSPORT',
    },
    antifraud: {
      fraud_risk: { risk_level: 'low', risk_score: 0, risk_indicators: [] },
      summary: { fraud_detected: false, fraud_sources: [] },
    },
    ...overrides,
  }
}

describe('interpretSmileIdResult — verdict mapping', () => {
  it('clear → approved, with extracted identity fields and evidence', () => {
    const { correlation, verdict } = interpretSmileIdResult(resultPayload({}))
    expect(correlation.kycCaseId).toBe('case-123')
    expect(verdict.outcome).toBe('approved')
    if (verdict.outcome === 'approved') {
      expect(verdict.fullName).toBe('Amina Fatou Clearwater')
      expect(verdict.idNumber).toBe('00000000000')
      expect(verdict.idType).toBe('PASSPORT')
      expect(verdict.country).toBe('KE')
      expect(verdict.evidence).toContain('document_verification: clear')
      expect(verdict.evidence).toContain('receipt: issued')
    }
  })

  it('clear + fraud_detected → review, never approved (fail-closed)', () => {
    const { verdict } = interpretSmileIdResult(
      resultPayload({ antifraud: { summary: { fraud_detected: true, fraud_sources: ['smile_secure'] } } })
    )
    expect(verdict.outcome).toBe('review')
    if (verdict.outcome === 'review') {
      expect(verdict.reason).toBe('fraud_flagged')
      expect(verdict.evidence).toContain('FRAUD FLAGGED')
    }
  })

  it('attention → review with the vendor reason', () => {
    const { verdict } = interpretSmileIdResult(resultPayload({ status: 'attention', reason: 'document.glare' }))
    expect(verdict.outcome).toBe('review')
    if (verdict.outcome === 'review') expect(verdict.reason).toBe('document.glare')
  })

  it('block → rejected', () => {
    const { verdict } = interpretSmileIdResult(resultPayload({ status: 'block', reason: 'document.forged', id_fields: null }))
    expect(verdict.outcome).toBe('rejected')
    if (verdict.outcome === 'rejected') expect(verdict.reason).toBe('document.forged')
  })

  it('error → error (a job failure, not a verdict on the person)', () => {
    const { verdict } = interpretSmileIdResult(resultPayload({ status: 'error', reason: 'images.unusable', id_fields: null }))
    expect(verdict.outcome).toBe('error')
  })

  it('processing → processing (interim, changes nothing)', () => {
    const { verdict } = interpretSmileIdResult(resultPayload({ status: 'processing' }))
    expect(verdict.outcome).toBe('processing')
  })

  it('unknown status → unrecognized (must change nothing)', () => {
    const { verdict } = interpretSmileIdResult(resultPayload({ status: 'APPROVED_TOTALLY' }))
    expect(verdict.outcome).toBe('unrecognized')
  })

  it('non-object payloads → unrecognized', () => {
    expect(interpretSmileIdResult(null).verdict.outcome).toBe('unrecognized')
    expect(interpretSmileIdResult('clear').verdict.outcome).toBe('unrecognized')
    expect(interpretSmileIdResult([1, 2]).verdict.outcome).toBe('unrecognized')
  })

  it('joins name parts when full_name is absent', () => {
    const { verdict } = interpretSmileIdResult(
      resultPayload({ id_fields: { first_name: 'Asha', other_names: '', last_name: 'Mrisho' } })
    )
    if (verdict.outcome === 'approved') expect(verdict.fullName).toBe('Asha Mrisho')
  })

  it('tolerates missing partner_params and id_fields', () => {
    const { correlation, verdict } = interpretSmileIdResult({ status: 'clear' })
    expect(correlation.kycCaseId).toBeNull()
    expect(verdict.outcome).toBe('approved')
    if (verdict.outcome === 'approved') expect(verdict.fullName).toBeNull()
  })
})

describe('supportsEnhancedKyc — coverage set', () => {
  it('covers the eight registry-lookup countries', () => {
    for (const c of ['CI', 'GH', 'KE', 'NG', 'UG', 'ZA', 'ZM', 'ZW']) expect(supportsEnhancedKyc(c)).toBe(true)
  })
  it('does NOT cover Tanzania — Selcom stays the NIDA authority', () => {
    expect(supportsEnhancedKyc('TZ')).toBe(false)
  })
  it('handles lowercase and junk', () => {
    expect(supportsEnhancedKyc('ng')).toBe(true)
    expect(supportsEnhancedKyc('')).toBe(false)
  })
})
