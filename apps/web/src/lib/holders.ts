import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, PLATFORM_TREASURY_ADDRESS } from '@/lib/env'

/**
 * The holders register: every address holding nTZS matched to the verified
 * identity behind it.
 *
 * The on-chain holder list is public (Basescan shows it to anyone), so the
 * platform's answer must be ready before it is asked for: each address is
 * either a participant with a named identity-verification state, or a named
 * platform account — and the two together must add up to the supply. The gap,
 * if any, is reported as a figure ("unattributed"), never hidden.
 *
 * Two rules carried over from the attestation and the BoT report:
 *  - A balance that could not be read is null and reported as a failed read —
 *    never zero, and never silently dropped from the totals note.
 *  - Sums only include what was actually read; the coverage figure names how
 *    many reads are missing from it.
 */

export interface HolderRow {
  address: string
  frozen: boolean
  userId: string
  email: string
  role: string
  /** Latest kyc_cases status for the user, or null when no case exists. */
  kycStatus: string | null
  kycProvider: string | null
  /** On-chain balance in TZS; null when the read failed (never zero). */
  balanceTzs: number | null
  /** Deposits + redemptions + outbound transfers in the last 30 days. */
  activity30d: number
  lastActivityAt: string | null
}

export interface SystemAccount {
  label: string
  address: string
  balanceTzs: number | null
}

export interface HoldersView {
  holders: HolderRow[]
  systemAccounts: SystemAccount[]
  /** On-chain totalSupply in TZS; null when the chain could not be read. */
  supplyTzs: number | null
  /** Sum of successfully read balances (participants + system accounts). */
  attributedTzs: number
  /** supply − attributed; meaningful only when supply is known and all reads succeeded. */
  unattributedTzs: number | null
  /** Addresses whose balance read failed — the totals exclude them. */
  failedReads: number
  /** Participants currently holding a balance > 0. */
  holdingCount: number
  /** Of those holding, how many have an approved verification case. */
  holdingVerifiedCount: number
  chainError?: string
  generatedAt: string
}

interface DbHolderRow {
  address: string
  frozen: boolean
  user_id: string
  email: string
  role: string
  kyc_status: string | null
  kyc_provider: string | null
  activity_30d: string
  last_activity_at: string | null
}

/** Tolerance for supply reconciliation — sub-shilling dust from 18-dp rounding. */
const UNATTRIBUTED_TOLERANCE_TZS = 1

/**
 * Pure assembly: DB identity rows + a balance map + the supply figure become
 * the view. Kept free of I/O so the accounting rules are unit-tested.
 */
export function assembleHoldersView(input: {
  rows: DbHolderRow[]
  /** lowercase address → TZS balance, or null when that read failed. */
  balances: Map<string, number | null>
  supplyTzs: number | null
  systemAccounts: SystemAccount[]
  chainError?: string
}): HoldersView {
  const holders: HolderRow[] = input.rows.map((r) => {
    const balance = input.balances.has(r.address.toLowerCase())
      ? input.balances.get(r.address.toLowerCase())!
      : null
    return {
      address: r.address,
      frozen: r.frozen,
      userId: r.user_id,
      email: r.email,
      role: r.role,
      kycStatus: r.kyc_status,
      kycProvider: r.kyc_provider,
      balanceTzs: balance,
      activity30d: Number(r.activity_30d ?? 0),
      lastActivityAt: r.last_activity_at,
    }
  })

  // Largest balances first; unreadable balances sink below zero-balances so a
  // failed read is visible rather than shuffled in as if it were empty.
  holders.sort((a, b) => {
    const av = a.balanceTzs ?? -1
    const bv = b.balanceTzs ?? -1
    if (bv !== av) return bv - av
    return b.activity30d - a.activity30d
  })

  const readHolderBalances = holders.filter((h) => h.balanceTzs != null)
  const readSystemBalances = input.systemAccounts.filter((s) => s.balanceTzs != null)
  const attributedTzs =
    readHolderBalances.reduce((sum, h) => sum + (h.balanceTzs ?? 0), 0) +
    readSystemBalances.reduce((sum, s) => sum + (s.balanceTzs ?? 0), 0)

  const failedReads =
    holders.length - readHolderBalances.length + (input.systemAccounts.length - readSystemBalances.length)

  // The reconciliation figure is only a claim when it is complete: with any
  // read missing (or no supply), the honest answer is "unknown", not a number
  // that silently excludes part of the ledger.
  const unattributedTzs =
    input.supplyTzs != null && failedReads === 0 ? input.supplyTzs - attributedTzs : null

  const holding = holders.filter((h) => (h.balanceTzs ?? 0) > 0)

  return {
    holders,
    systemAccounts: input.systemAccounts,
    supplyTzs: input.supplyTzs,
    attributedTzs,
    unattributedTzs,
    failedReads,
    holdingCount: holding.length,
    holdingVerifiedCount: holding.filter((h) => h.kycStatus === 'approved').length,
    chainError: input.chainError,
    generatedAt: new Date().toISOString(),
  }
}

/** True when the reconciliation gap exceeds rounding dust and must be explained. */
export function hasUnattributedBalance(view: HoldersView): boolean {
  return view.unattributedTzs != null && Math.abs(view.unattributedTzs) > UNATTRIBUTED_TOLERANCE_TZS
}

const ERC20_READS = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]

/** Batched balance reads; a failed address yields null, never zero. */
async function readBalances(
  contract: ethers.Contract,
  addresses: string[]
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>()
  const CHUNK = 40
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK)
    const results = await Promise.allSettled(chunk.map((a) => contract.balanceOf(a)))
    results.forEach((res, j) => {
      out.set(
        chunk[j].toLowerCase(),
        res.status === 'fulfilled' ? Number(ethers.formatUnits(res.value, 18)) : null
      )
    })
  }
  return out
}

/** Load the full view: identities from the database, balances from Base mainnet. */
export async function loadHoldersView(): Promise<HoldersView> {
  const { sql } = getDb()

  const rows = await sql<DbHolderRow[]>`
    select w.address,
           w.frozen,
           u.id as user_id,
           u.email,
           u.role,
           k.status as kyc_status,
           k.provider as kyc_provider,
           coalesce(a.n30, 0)::text as activity_30d,
           a.last_at as last_activity_at
    from wallets w
    join users u on u.id = w.user_id
    left join lateral (
      select status, provider from kyc_cases
      where user_id = u.id
      order by created_at desc
      limit 1
    ) k on true
    left join lateral (
      select count(*) filter (where t.at > now() - interval '30 days') as n30,
             max(t.at) as last_at
      from (
        select created_at as at from deposit_requests where user_id = u.id
        union all
        select created_at from burn_requests where user_id = u.id
        union all
        select created_at from transfers where from_user_id = u.id
      ) t
    ) a on true
    where w.chain = 'base'
  `

  const treasury = PLATFORM_TREASURY_ADDRESS
  let balances = new Map<string, number | null>()
  let supplyTzs: number | null = null
  let systemAccounts: SystemAccount[] = treasury ? [{ label: 'Platform treasury', address: treasury, balanceTzs: null }] : []
  let chainError: string | undefined

  if (!NTZS_CONTRACT_ADDRESS_BASE) {
    chainError = 'NTZS_CONTRACT_ADDRESS_BASE is not configured — identities shown, balances unavailable'
  } else {
    try {
      const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
      const contract = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, ERC20_READS, provider)

      // Wallet rows whose user also serves as a system account would be
      // double-counted; the wallets table is the identity register, so the
      // treasury is read separately and excluded from the identity list.
      const holderAddresses = rows
        .map((r) => r.address)
        .filter((a) => !treasury || a.toLowerCase() !== treasury.toLowerCase())

      const [supply, balanceMap, treasuryBalances] = await Promise.all([
        contract.totalSupply().then((s: bigint) => Number(ethers.formatUnits(s, 18))).catch(() => null),
        readBalances(contract, holderAddresses),
        treasury ? readBalances(contract, [treasury]) : Promise.resolve(new Map<string, number | null>()),
      ])

      supplyTzs = supply
      balances = balanceMap
      if (treasury) {
        systemAccounts = [
          {
            label: 'Platform treasury',
            address: treasury,
            balanceTzs: treasuryBalances.get(treasury.toLowerCase()) ?? null,
          },
        ]
      }
      if (supply == null) chainError = 'totalSupply() could not be read — reconciliation unavailable'
    } catch (err) {
      chainError = `chain read failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`
    }
  }

  const view = assembleHoldersView({
    rows: rows.filter((r) => !treasury || r.address.toLowerCase() !== treasury.toLowerCase()),
    balances,
    supplyTzs,
    systemAccounts,
    chainError,
  })
  return view
}

/** CSV of the full register — the export handed over when a list is asked for. */
export function holdersCsv(view: HoldersView): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    'address,email,role,kyc_status,kyc_provider,balance_tzs,activity_30d,last_activity_at,frozen',
    ...view.holders.map((h) =>
      [
        h.address,
        h.email,
        h.role,
        h.kycStatus ?? 'no_case',
        h.kycProvider ?? '',
        h.balanceTzs == null ? 'read_failed' : h.balanceTzs,
        h.activity30d,
        h.lastActivityAt ?? '',
        h.frozen ? 'yes' : 'no',
      ]
        .map(esc)
        .join(',')
    ),
    ...view.systemAccounts.map((s) =>
      [s.address, s.label, 'system', '', '', s.balanceTzs == null ? 'read_failed' : s.balanceTzs, '', '', '']
        .map(esc)
        .join(',')
    ),
  ]
  return lines.join('\n') + '\n'
}
