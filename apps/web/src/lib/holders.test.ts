import { describe, it, expect, vi } from 'vitest'

import { assembleHoldersView, hasUnattributedBalance, holdersCsv, verifiedNamedHolders } from './holders'

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
    kyc_review_reason: 'NIDA holder: ASHA JUMA MRISHO · Selcom NIDA+MSISDN pair verified' as string | null,
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

/**
 * What a supervisor is owed is a person's name, from the registry that
 * verified it. Not an email address, not a self-declared profile, and not a
 * name attached to a case that was never approved.
 */
describe('holders are named only from the verification that approved them', () => {
  it('takes the name the verifier returned', () => {
    const view = assembleHoldersView({
      rows: [row()],
      balances: new Map([['0xaaa0000000000000000000000000000000000001', 10]]),
      supplyTzs: 10,
      systemAccounts: [],
    })
    expect(view.holders[0].verifiedName).toBe('ASHA JUMA MRISHO')
  })

  it('reads a partner attestation the same way', () => {
    const view = assembleHoldersView({
      rows: [row({ kyc_provider: 'partner_attested', kyc_review_reason: 'Holder: JANE WANJIRU DOE · attested by NEDApay' })],
      balances: new Map([['0xaaa0000000000000000000000000000000000001', 10]]),
      supplyTzs: 10,
      systemAccounts: [],
    })
    expect(view.holders[0].verifiedName).toBe('JANE WANJIRU DOE')
  })

  it('refuses a name from a case that was not approved', () => {
    // The evidence string exists on pending and rejected cases too. Presenting
    // one as a verified identity would be verification thrown away.
    for (const status of ['pending', 'rejected', null]) {
      const view = assembleHoldersView({
        rows: [row({ kyc_status: status })],
        balances: new Map([['0xaaa0000000000000000000000000000000000001', 10]]),
        supplyTzs: 10,
        systemAccounts: [],
      })
      expect(view.holders[0].verifiedName, `status ${status}`).toBeNull()
    }
  })

  it('never substitutes an email or a declared profile name', () => {
    const view = assembleHoldersView({
      rows: [row({ kyc_review_reason: 'Selcom NIDA+MSISDN pair verified' })],
      balances: new Map([['0xaaa0000000000000000000000000000000000001', 10]]),
      supplyTzs: 10,
      systemAccounts: [],
    })
    expect(view.holders[0].verifiedName).toBeNull()
    expect(verifiedNamedHolders(view)).toHaveLength(0)
  })

  it('lists only named, approved holders, largest holding first', () => {
    const view = assembleHoldersView({
      rows: [
        row({ email: 'small@x.com', kyc_review_reason: 'NIDA holder: SMALL HOLDER' }),
        row({ address: '0xBBB0000000000000000000000000000000000002', user_id: 'u2', email: 'big@x.com', kyc_review_reason: 'NIDA holder: BIG HOLDER' }),
        row({ address: '0xCCC0000000000000000000000000000000000003', user_id: 'u3', email: 'nope@x.com', kyc_status: 'pending' }),
      ],
      balances: new Map([
        ['0xaaa0000000000000000000000000000000000001', 5],
        ['0xbbb0000000000000000000000000000000000002', 900],
        ['0xccc0000000000000000000000000000000000003', 400],
      ]),
      supplyTzs: 1305,
      systemAccounts: [],
    })
    expect(verifiedNamedHolders(view).map((h) => h.verifiedName)).toEqual(['BIG HOLDER', 'SMALL HOLDER'])
  })
})

/**
 * The wallet count is not the participant count. Wallets predating the sandbox
 * remain on the register, and reporting only the total is what makes a legacy
 * population look like a breach of an approved cohort.
 */
describe('the cohort is reported as its parts', () => {
  const mixed = () =>
    assembleHoldersView({
      rows: [
        row({ kyc_review_reason: 'NIDA holder: VERIFIED HOLDING', activity_30d: '3' }),
        row({ address: '0xBBB0000000000000000000000000000000000002', user_id: 'u2', email: 'b@x.com', kyc_review_reason: 'NIDA holder: VERIFIED EMPTY' }),
        row({ address: '0xCCC0000000000000000000000000000000000003', user_id: 'u3', email: 'c@x.com', kyc_status: null, kyc_provider: null, kyc_review_reason: null }),
        row({ address: '0xDDD0000000000000000000000000000000000004', user_id: 'u4', email: 'd@x.com', kyc_status: null, kyc_provider: null, kyc_review_reason: null }),
      ],
      balances: new Map([
        ['0xaaa0000000000000000000000000000000000001', 500],
        ['0xbbb0000000000000000000000000000000000002', 0],
        ['0xccc0000000000000000000000000000000000003', 0],
        ['0xddd0000000000000000000000000000000000004', 75],
      ]),
      supplyTzs: 575,
      systemAccounts: [],
    })

  it('splits verified from unverified rather than reporting one total', () => {
    const c = mixed().cohort
    expect(c.totalWallets).toBe(4)
    expect(c.verified).toBe(2)
    expect(c.unverified).toBe(2)
  })

  it('counts verified holders who actually hold and who actually transact', () => {
    const c = mixed().cohort
    expect(c.verifiedHolding).toBe(1)
    expect(c.verifiedActive30d).toBe(1)
    expect(c.verifiedNamed).toBe(2)
  })

  it('surfaces unverified holders who hold a balance — the ones that need an answer', () => {
    expect(mixed().cohort.unverifiedHolding).toBe(1)
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
    // A platform account is named in the name column and typed as system —
    // it has no verified holder because it is not a person.
    expect(csv).toContain('Platform treasury,0xT,,system')
    expect(csv.split('\n')[0]).toBe(
      'verified_name,address,email,role,kyc_status,kyc_provider,balance_tzs,activity_30d,last_activity_at,frozen'
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
