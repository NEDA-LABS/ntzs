import { describe, it, expect } from 'vitest'

import { isValidTanzanianPhone as snippeValid } from './snippe'
import { isValidTanzanianPhone as azamValid, detectAzamPayProvider } from './azampay'
import { isValidTanzanianPhone as selcomValid, detectWalletFiCode } from './selcom'
import { detectNetwork } from './routing'

// One case list, asserted against ALL copies — the implementations must
// never drift (lib/psp re-exports snippe's; azampay.ts and selcom.ts keep
// their own).
const CASES: Array<[string, boolean]> = [
  ['0744277496', true], // Vodacom
  ['0768123456', true], // Airtel (076x upper split)
  ['0795851215', true], // Vodacom 079 — missing until 28 Jul 2026; locked 079x users out platform-wide
  ['+255795851215', true], // same, E.164 form (the exact shape partners send)
  ['255712345678', true], // Tigo, 255-prefixed
  ['0653456789', true], // Tigo
  ['0612345678', true], // Halotel
  ['0622345678', true], // Halotel (Halopesa)
  ['0731234567', true], // TTCL T-Pesa
  ['0801234567', false], // unassigned range
  ['12345', false], // too short
  ['', false],
]

describe('isValidTanzanianPhone (snippe, azampay and selcom copies stay in sync)', () => {
  for (const [phone, ok] of CASES) {
    it(`${JSON.stringify(phone)} → ${ok}`, () => {
      expect(snippeValid(phone)).toBe(ok)
      expect(azamValid(phone)).toBe(ok)
      expect(selcomValid(phone)).toBe(ok)
    })
  }
})

describe('079 routes as Vodacom on every rail (TCRA numbering plan)', () => {
  it('detectNetwork → vodacom', () => {
    expect(detectNetwork('0795851215')).toBe('vodacom')
    expect(detectNetwork('+255795851215')).toBe('vodacom')
  })

  it('Selcom wallet FI code → MPESA (the code proven live for Vodacom)', () => {
    expect(detectWalletFiCode('255795851215')).toBe('MPESA')
  })

  it('AzamPay provider → azampesa (Vodacom M-PESA)', () => {
    expect(detectAzamPayProvider('255795851215')).toBe('azampesa')
  })
})
