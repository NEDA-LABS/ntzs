import { describe, it, expect, beforeEach, afterAll } from 'vitest'

import { nedaProtocolFeeTzs } from './protocol-fee'

const SAVED_BPS = process.env.NEDA_PROTOCOL_FEE_BPS
const SAVED_FLOOR = process.env.NEDA_PROTOCOL_FEE_FLOOR_TZS

function setFee(bps: string | undefined, floor: string | undefined) {
  if (bps === undefined) delete process.env.NEDA_PROTOCOL_FEE_BPS
  else process.env.NEDA_PROTOCOL_FEE_BPS = bps
  if (floor === undefined) delete process.env.NEDA_PROTOCOL_FEE_FLOOR_TZS
  else process.env.NEDA_PROTOCOL_FEE_FLOOR_TZS = floor
}

beforeEach(() => setFee(undefined, undefined)) // defaults 30 / 30
afterAll(() => setFee(SAVED_BPS, SAVED_FLOOR))

describe('nedaProtocolFeeTzs (rail-operator earn)', () => {
  it('defaults to 30 bps with a 30 TZS floor', () => {
    expect(nedaProtocolFeeTzs(1000)).toBe(30) // max(3, 30)
    expect(nedaProtocolFeeTzs(10_000)).toBe(30) // max(30, 30)
    expect(nedaProtocolFeeTzs(20_000)).toBe(60) // max(60, 30)
    expect(nedaProtocolFeeTzs(100_000)).toBe(300) // 0.30%
    expect(nedaProtocolFeeTzs(500_000)).toBe(1500)
  })

  it('honours env overrides', () => {
    setFee('50', '50')
    expect(nedaProtocolFeeTzs(1000)).toBe(50) // max(5, 50)
    expect(nedaProtocolFeeTzs(100_000)).toBe(500) // 0.50%
  })

  it('is disabled only when BOTH bps and floor are 0', () => {
    setFee('0', '0')
    expect(nedaProtocolFeeTzs(100_000)).toBe(0)
    setFee('0', '30') // floor-only still earns
    expect(nedaProtocolFeeTzs(1000)).toBe(30)
    setFee('30', '0') // bps-only still earns above the (0) floor
    expect(nedaProtocolFeeTzs(100_000)).toBe(300)
  })

  it('never charges a non-positive principal', () => {
    expect(nedaProtocolFeeTzs(0)).toBe(0)
    expect(nedaProtocolFeeTzs(-5)).toBe(0)
  })
})
