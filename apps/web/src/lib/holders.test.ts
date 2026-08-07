import { describe, it, expect, vi } from 'vitest'

import { assembleHoldersView, hasUnattributedBalance, holdersCsv } from './holders'

vi.mock('@/lib/db', () => ({ getDb: () => ({ sql: () => Promise.resolve([]) }) }))

function row(over: Partial<Parameters<typeof assembleHoldersView>[0]['rows'][0]> = {}) {
  return {
    address: '0xAAA0000000000000000000000000000000000001',
    frozen: false,
    user_id: 'u1',
    email: 'holder@example.com',
    role: 'end_user',
    kyc_status: 'approved' as string | null,
    kyc_provider: 'selcom' as string | null,
    activity_30d: '0',
    last_activity_at: null,
    ...over,
  }
}

/**
 * The register's one hard promise: what we publish reconciles to the chain,
 * and what we could not read is reported as unread — never as zero, and never
 * silently dropped while the totals pretend to be complete.
 */
describe('supply reconciliation', () => {
  it('attributes read balances and names the gap', () => {
    const view = assembleHoldersView({
      rows: [row(), row({ address: '0xBBB0000000000000000000000000000000000002', user_id: 'u2', email: 'b@x.com' })],
      balances: new Map([
        ['0xaaa0000000000000000000000000000000000001', 600],
        ['0xbbb0000000000000000000000000000000000002', 250],
      ]),
      supplyTzs: 1000,
      systemAccounts: [{ label: 'Platform treasury', address: '0xT', balanceTzs: 100 }],
    })
    expect(view.attributedTzs).toBe(950)
    expect(view.unattributedTzs).toBe(50)
    expect(hasUnattributedBalance(view)).toBe(true)
  })

  it('treats sub-shilling dust as reconciled', () => {
    const view = assembleHoldersView({
      rows: [row()],
      balances: new Map([['0xaaa0000000000000000000000000000000000001', 999.5]]),
      supplyTzs: 1000,
      systemAccounts: [],
    })
    expect(hasUnattributedBalance(view)).toBe(false)
  })

  it('withholds the reconciliation figure while any read is missing', () => {
    // A gap computed from an incomplete sum would accuse an unknown address of
    // holding tokens that are really just an unread wallet of ours.
    const view = assembleHoldersView({
      rows: [
        row(),
        row({ address: '0xBBB0000000000000000000000000000000000002', user_id: 'u2', email: 'b@x.com' }),
      ],
      balances: new Map<string, number | null>([
        ['0xaaa0000000000000000000000000000000000001', 600],
        ['0xbbb0000000000000000000000000000000000002', null],
      ]),
      supplyTzs: 1000,
      systemAccounts: [],
    })
    expect(view.failedReads).toBe(1)
    expect(view.unattributedTzs).toBeNull()
    expect(hasUnattributedBalance(view)).toBe(false)
  })

  it('never reports an unknown supply as reconciled', () => {
    const view = assembleHoldersView({
      rows: [row()],
      balances: new Map([['0xaaa0000000000000000000000000000000000001', 600]]),
      supplyTzs: null,
      systemAccounts: [],
      chainError: 'rpc down',
    })
    expect(view.supplyTzs).toBeNull()
    expect(view.unattributedTzs).toBeNull()
  })
})

describe('identity coverage and ordering', () => {
  it('counts verification only among participants actually holding', () => {
    const view = assembleHoldersView({
      rows: [
        row(),
        row({ address: '0xBBB0000000000000000000000000000000000002', user_id: 'u2', email: 'b@x.com', kyc_status: null }),
        row({ address: '0xCCC0000000000000000000000000000000000003', user_id: 'u3', email: 'c@x.com', kyc_status: 'pending' }),
      ],
      balances: new Map([
        ['0xaaa0000000000000000000000000000000000001', 500],
        ['0xbbb0000000000000000000000000000000000002', 0],
        ['0xccc0000000000000000000000000000000000003', 40],
      ]),
      supplyTzs: 540,
      systemAccounts: [],
    })
    expect(view.holdingCount).toBe(2)
    expect(view.holdingVerifiedCount).toBe(1)
  })

  it('sorts by balance with failed reads below empty wallets, never shuffled in as zero', () => {
    const view = assembleHoldersView({
      rows: [
        row({ address: '0xAAA0000000000000000000000000000000000001', email: 'small@x.com' }),
        row({ address: '0xBBB0000000000000000000000000000000000002', user_id: 'u2', email: 'failed@x.com' }),
        row({ address: '0xCCC0000000000000000000000000000000000003', user_id: 'u3', email: 'big@x.com' }),
      ],
      balances: new Map<string, number | null>([
        ['0xaaa0000000000000000000000000000000000001', 5],
        ['0xbbb0000000000000000000000000000000000002', null],
        ['0xccc0000000000000000000000000000000000003', 900],
      ]),
      supplyTzs: null,
      systemAccounts: [],
    })
    expect(view.holders.map((h) => h.email)).toEqual(['big@x.com', 'small@x.com', 'failed@x.com'])
    expect(view.holders[2].balanceTzs).toBeNull()
  })

  it('matches balances case-insensitively — checksummed and lowercase addresses are the same wallet', () => {
    const view = assembleHoldersView({
      rows: [row({ address: '0xAbCd000000000000000000000000000000000001' })],
      balances: new Map([['0xabcd000000000000000000000000000000000001', 77]]),
      supplyTzs: 77,
      systemAccounts: [],
    })
    expect(view.holders[0].balanceTzs).toBe(77)
    expect(view.unattributedTzs).toBe(0)
  })
})

describe('the CSV export', () => {
  it('writes failed reads as read_failed, never zero, and escapes fields', () => {
    const view = assembleHoldersView({
      rows: [
        row({ email: 'has,comma@x.com' }),
        row({ address: '0xBBB0000000000000000000000000000000000002', user_id: 'u2', email: 'b@x.com' }),
      ],
      balances: new Map<string, number | null>([
        ['0xaaa0000000000000000000000000000000000001', 10],
        ['0xbbb0000000000000000000000000000000000002', null],
      ]),
      supplyTzs: null,
      systemAccounts: [{ label: 'Platform treasury', address: '0xT', balanceTzs: 3 }],
    })
    const csv = holdersCsv(view)
    expect(csv).toContain('"has,comma@x.com"')
    expect(csv).toContain('read_failed')
    expect(csv).not.toMatch(/read_failed.*\n.*,0,/m)
    expect(csv).toContain('Platform treasury,system')
    expect(csv.split('\n')[0]).toBe(
      'address,email,role,kyc_status,kyc_provider,balance_tzs,activity_30d,last_activity_at,frozen'
    )
  })

  it('writes a missing verification case as no_case, not as an empty claim', () => {
    const view = assembleHoldersView({
      rows: [row({ kyc_status: null, kyc_provider: null })],
      balances: new Map([['0xaaa0000000000000000000000000000000000001', 1]]),
      supplyTzs: 1,
      systemAccounts: [],
    })
    expect(holdersCsv(view)).toContain('no_case')
  })
})
