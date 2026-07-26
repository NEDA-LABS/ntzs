import { describe, expect, it } from 'vitest'

import { generateWebhookSecret, WEBHOOK_SECRET_PREFIX } from './auth'

describe('generateWebhookSecret', () => {
  it('mints a whsec_-prefixed 48-hex-char secret (matches the signup format)', () => {
    const secret = generateWebhookSecret()
    expect(secret).toMatch(/^whsec_[0-9a-f]{48}$/)
    expect(secret.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true)
    // 6-char prefix + 24 bytes as hex (48 chars) = 54, the on-disk length.
    expect(secret).toHaveLength(54)
  })

  it('is unique across calls (rotation never collides)', () => {
    const secrets = new Set(Array.from({ length: 200 }, () => generateWebhookSecret()))
    expect(secrets.size).toBe(200)
  })
})
