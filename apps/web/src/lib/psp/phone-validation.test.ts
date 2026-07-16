import { describe, it, expect } from 'vitest'

import { isValidTanzanianPhone as snippeValid } from './snippe'
import { isValidTanzanianPhone as azamValid } from './azampay'

// One case list, asserted against BOTH copies — the two implementations must
// never drift (lib/psp re-exports snippe's; azampay.ts keeps its own).
const CASES: Array<[string, boolean]> = [
  ['0744277496', true], // Vodacom
  ['0768123456', true], // Airtel (076x upper split)
  ['255712345678', true], // Tigo, 255-prefixed
  ['0653456789', true], // Tigo
  ['0612345678', true], // Halotel
  ['0622345678', true], // Halotel (Halopesa)
  ['0731234567', true], // TTCL T-Pesa
  ['0801234567', false], // unassigned range
  ['12345', false], // too short
  ['', false],
]

describe('isValidTanzanianPhone (snippe and azampay copies stay in sync)', () => {
  for (const [phone, ok] of CASES) {
    it(`${JSON.stringify(phone)} → ${ok}`, () => {
      expect(snippeValid(phone)).toBe(ok)
      expect(azamValid(phone)).toBe(ok)
    })
  }
})
