import { describe, expect, it } from 'vitest'

import {
  TRANSFER_TOPIC,
  alertFingerprint,
  chunkBlockRanges,
  dedupeExpected,
  dedupeLogs,
  evaluateInvariant,
  expectedFromFeeSweeps,
  expectedFromFills,
  expectedFromWalletTxs,
  matchTransfers,
  parseTransferLogs,
  toRawAmount,
  topicForAddress,
  type TransferLog,
} from './recon'

// tsconfig targets ES2017, so no bigint literals — build them from strings.
const bn = (v: string | number) => BigInt(v)

const SOLVER = '0xf4766439DC70f5B943Cc1918747b408b612ba646'
const USER = '0x1111111111111111111111111111111111111111'
const NTZS = '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'.toLowerCase()
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase()
const DECIMALS = { [NTZS]: 18, [USDC]: 6 }

const HASH_A = '0x' + 'aa'.repeat(32)
const HASH_B = '0x' + 'bb'.repeat(32)
const HASH_C = '0x' + 'cc'.repeat(32)

const NTZS_2549_78 = bn('2549780000000000000000')
const NTZS_100 = bn('100000000000000000000')

function log(overrides: Partial<TransferLog>): TransferLog {
  return {
    txHash: HASH_A,
    logIndex: 0,
    tokenAddress: NTZS,
    from: USER,
    to: SOLVER.toLowerCase(),
    amountRaw: bn(0),
    blockNumber: 100,
    ...overrides,
  }
}

describe('toRawAmount', () => {
  it('converts plain decimals at token precision', () => {
    expect(toRawAmount('2549.78', 18)).toBe(NTZS_2549_78)
    expect(toRawAmount('1000', 6)).toBe(bn('1000000000'))
    expect(toRawAmount('0', 18)).toBe(bn(0))
  })

  it('handles DB scale-18 strings for 6-decimals tokens (parseUnits would throw)', () => {
    expect(toRawAmount('2549.780000000000000000', 6)).toBe(bn('2549780000'))
  })

  it('rounds half-up on the first dropped digit', () => {
    expect(toRawAmount('1.2345675', 6)).toBe(bn('1234568'))
    expect(toRawAmount('1.2345674', 6)).toBe(bn('1234567'))
  })

  it('supports negatives and rejects non-numeric strings', () => {
    expect(toRawAmount('-5', 6)).toBe(bn('-5000000'))
    expect(toRawAmount('abc', 6)).toBeNull()
    expect(toRawAmount('1e5', 6)).toBeNull()
    expect(toRawAmount('', 6)).toBeNull()
    expect(toRawAmount('.5', 6)).toBeNull()
  })
})

describe('chunkBlockRanges', () => {
  it('splits inclusive ranges at the chunk size', () => {
    expect(chunkBlockRanges(0, 9998, 9999)).toEqual([{ fromBlock: 0, toBlock: 9998 }])
    expect(chunkBlockRanges(0, 9999, 9999)).toEqual([
      { fromBlock: 0, toBlock: 9998 },
      { fromBlock: 9999, toBlock: 9999 },
    ])
  })

  it('returns nothing for an empty range', () => {
    expect(chunkBlockRanges(100, 99, 9999)).toEqual([])
  })
})

describe('parseTransferLogs', () => {
  it('decodes ERC-20 Transfer logs (addresses lowered, hex block numbers)', () => {
    const [decoded] = parseTransferLogs([
      {
        address: NTZS.toUpperCase().replace('0X', '0x'),
        topics: [TRANSFER_TOPIC, topicForAddress(USER), topicForAddress(SOLVER)],
        data: '0x' + NTZS_2549_78.toString(16),
        transactionHash: HASH_A.toUpperCase().replace('0X', '0x'),
        logIndex: '0x2',
        blockNumber: '0x10',
      },
    ])
    expect(decoded).toEqual({
      txHash: HASH_A,
      logIndex: 2,
      tokenAddress: NTZS,
      from: USER,
      to: SOLVER.toLowerCase(),
      amountRaw: NTZS_2549_78,
      blockNumber: 16,
    })
  })

  it('skips non-ERC-20 shapes and reads empty data as zero', () => {
    const decoded = parseTransferLogs([
      // ERC-721 Transfer: tokenId is a 4th indexed topic
      {
        address: NTZS,
        topics: [TRANSFER_TOPIC, topicForAddress(USER), topicForAddress(SOLVER), '0x' + '0'.repeat(64)],
        data: '0x',
        transactionHash: HASH_A,
        blockNumber: 1,
      },
      { address: NTZS, topics: ['0x' + '12'.repeat(32), topicForAddress(USER), topicForAddress(SOLVER)], data: '0x1', transactionHash: HASH_B, blockNumber: 1 },
      { address: NTZS, topics: [TRANSFER_TOPIC, topicForAddress(USER), topicForAddress(SOLVER)], data: '0x', transactionHash: HASH_C, blockNumber: 1 },
    ])
    expect(decoded).toHaveLength(1)
    expect(decoded[0].txHash).toBe(HASH_C)
    expect(decoded[0].amountRaw).toBe(bn(0))
  })
})

describe('dedupeLogs', () => {
  it('drops the duplicate a solver self-transfer produces across the sent/received queries', () => {
    const l = log({ from: SOLVER.toLowerCase(), to: SOLVER.toLowerCase() })
    expect(dedupeLogs([l, { ...l }])).toHaveLength(1)
    expect(dedupeLogs([l, { ...l, logIndex: 1 }])).toHaveLength(2)
  })
})

describe('expected-transfer builders', () => {
  it('collapses the historical lp_wallet_transactions double rows (same tx, symbol case differs)', () => {
    const rows = [
      { id: 'row-1', type: 'activation_sweep', txHash: HASH_A, tokenAddress: NTZS, amount: '1000', decimals: 18 },
      { id: 'row-2', type: 'activation_sweep', txHash: HASH_A.toUpperCase().replace('0X', '0x'), tokenAddress: NTZS.toUpperCase().replace('0X', '0x'), amount: '1000', decimals: 18 },
    ]
    const deduped = dedupeExpected(expectedFromWalletTxs(rows))
    expect(deduped).toHaveLength(1)
    expect(deduped[0]).toMatchObject({ source: 'lp_wallet:activation_sweep', direction: 'in', amountRaw: bn('1000000000000000000000') })
  })

  it('skips wallet rows without a tx hash (mpesa deposits pre-broadcast)', () => {
    expect(expectedFromWalletTxs([{ id: 'x', type: 'deposit', txHash: null, tokenAddress: NTZS, amount: '5', decimals: 18 }])).toHaveLength(0)
  })

  it('splits a fill into its taker→solver and solver→taker legs', () => {
    const [inLeg, outLeg] = expectedFromFills(
      [{ id: 'fill-1', inTxHash: HASH_A, outTxHash: HASH_B, fromToken: USDC, toToken: NTZS, amountIn: '1', amountOut: '2549.78' }],
      DECIMALS,
    )
    expect(inLeg).toMatchObject({ source: 'lp_fill:in', txHash: HASH_A, direction: 'in', tokenAddress: USDC, amountRaw: bn('1000000') })
    expect(outLeg).toMatchObject({ source: 'lp_fill:out', txHash: HASH_B, direction: 'out', tokenAddress: NTZS, amountRaw: NTZS_2549_78 })
  })

  it('marks fee sweeps as outbound', () => {
    const [sweep] = expectedFromFeeSweeps([{ id: 's1', txHash: HASH_C, tokenAddress: NTZS, amount: '12.5' }], DECIMALS)
    expect(sweep).toMatchObject({ source: 'fee_sweep', direction: 'out', amountRaw: bn('12500000000000000000') })
  })
})

describe('matchTransfers', () => {
  const fillExpected = expectedFromFills(
    [{ id: 'fill-1', inTxHash: HASH_A, outTxHash: HASH_B, fromToken: USDC, toToken: NTZS, amountIn: '1', amountOut: '2549.78' }],
    DECIMALS,
  )

  it('explains both legs of a recorded fill', () => {
    const logs = [
      log({ txHash: HASH_A, tokenAddress: USDC, from: USER, to: SOLVER.toLowerCase(), amountRaw: bn('1000000') }),
      log({ txHash: HASH_B, tokenAddress: NTZS, from: SOLVER.toLowerCase(), to: USER, amountRaw: NTZS_2549_78 }),
    ]
    const { matched, anomalies } = matchTransfers(logs, fillExpected, { solver: SOLVER })
    expect(anomalies).toHaveLength(0)
    expect(matched.map((m) => m.source)).toEqual(['lp_fill:in', 'lp_fill:out'])
  })

  it('flags a transfer no ledger row shares a tx hash with', () => {
    const { matched, anomalies } = matchTransfers(
      [log({ txHash: HASH_C, from: SOLVER.toLowerCase(), to: USER, amountRaw: bn(42) })],
      fillExpected,
      { solver: SOLVER },
    )
    expect(matched).toHaveLength(0)
    expect(anomalies).toEqual([
      expect.objectContaining({ kind: 'unmatched', direction: 'out' }),
    ])
  })

  it('classifies unmatched inbound micro-transfers as dust (spam sprays must not page)', () => {
    const { anomalies } = matchTransfers(
      [log({ txHash: HASH_C, tokenAddress: USDC, from: USER, to: SOLVER.toLowerCase(), amountRaw: bn(26) })], // 0.000026 USDC
      fillExpected,
      { solver: SOLVER, dustRaw: () => bn(10_000) }, // 0.01 USDC ceiling
    )
    expect(anomalies).toEqual([expect.objectContaining({ kind: 'dust', direction: 'in' })])
  })

  it('never dust-classifies outbound transfers, however small', () => {
    const { anomalies } = matchTransfers(
      [log({ txHash: HASH_C, tokenAddress: USDC, from: SOLVER.toLowerCase(), to: USER, amountRaw: bn(1) })],
      fillExpected,
      { solver: SOLVER, dustRaw: () => bn(10_000) },
    )
    expect(anomalies).toEqual([expect.objectContaining({ kind: 'unmatched', direction: 'out' })])
  })

  it('keeps unmatched inbound transfers above the dust ceiling as unmatched', () => {
    const { anomalies } = matchTransfers(
      [log({ txHash: HASH_C, tokenAddress: USDC, from: USER, to: SOLVER.toLowerCase(), amountRaw: bn(10_001) })],
      fillExpected,
      { solver: SOLVER, dustRaw: () => bn(10_000) },
    )
    expect(anomalies).toEqual([expect.objectContaining({ kind: 'unmatched', direction: 'in' })])
  })

  it('without dustRaw every unmatched transfer stays unmatched (backward compat)', () => {
    const { anomalies } = matchTransfers(
      [log({ txHash: HASH_C, tokenAddress: USDC, from: USER, to: SOLVER.toLowerCase(), amountRaw: bn(1) })],
      fillExpected,
      { solver: SOLVER },
    )
    expect(anomalies).toEqual([expect.objectContaining({ kind: 'unmatched', direction: 'in' })])
  })

  it('flags a shared-hash transfer whose amount disagrees beyond tolerance', () => {
    const { anomalies } = matchTransfers(
      [log({ txHash: HASH_B, tokenAddress: NTZS, from: SOLVER.toLowerCase(), to: USER, amountRaw: bn('2000000000000000000000') })],
      fillExpected,
      { solver: SOLVER, toleranceRaw: () => bn('100000000000000') },
    )
    expect(anomalies).toEqual([expect.objectContaining({ kind: 'mismatched' })])
    expect(anomalies[0].detail).toContain('amount')
  })

  it('absorbs recording dust within the tolerance', () => {
    const { matched, anomalies } = matchTransfers(
      [log({ txHash: HASH_B, tokenAddress: NTZS, from: SOLVER.toLowerCase(), to: USER, amountRaw: NTZS_2549_78 + bn('10000000000000') })],
      fillExpected,
      { solver: SOLVER, toleranceRaw: () => bn('100000000000000') },
    )
    expect(anomalies).toHaveLength(0)
    expect(matched).toHaveLength(1)
  })

  it('flags a shared-hash transfer flowing the wrong way', () => {
    // deactivation_return is solver → LP; an inbound transfer on that hash is wrong.
    const expected = expectedFromWalletTxs([
      { id: 'w1', type: 'deactivation_return', txHash: HASH_A, tokenAddress: NTZS, amount: '100', decimals: 18 },
    ])
    const { anomalies } = matchTransfers(
      [log({ txHash: HASH_A, tokenAddress: NTZS, from: USER, to: SOLVER.toLowerCase(), amountRaw: NTZS_100 })],
      expected,
      { solver: SOLVER },
    )
    expect(anomalies).toEqual([expect.objectContaining({ kind: 'mismatched' })])
    expect(anomalies[0].detail).toContain('direction')
  })

  it('lets either-direction types (deposit/withdrawal) match both ways', () => {
    const expected = expectedFromWalletTxs([
      { id: 'w1', type: 'deposit', txHash: HASH_A, tokenAddress: NTZS, amount: '100', decimals: 18 },
    ])
    const { matched, anomalies } = matchTransfers(
      [log({ txHash: HASH_A, tokenAddress: NTZS, from: USER, to: SOLVER.toLowerCase(), amountRaw: NTZS_100 })],
      expected,
      { solver: SOLVER },
    )
    expect(anomalies).toHaveLength(0)
    expect(matched[0].source).toBe('lp_wallet:deposit')
  })

  it('matches on hash+token alone when the token decimals are unknown', () => {
    const exotic = '0x9999999999999999999999999999999999999999'
    const expected = expectedFromFills(
      [{ id: 'f1', inTxHash: HASH_A, outTxHash: HASH_B, fromToken: exotic, toToken: NTZS, amountIn: '7', amountOut: '1' }],
      DECIMALS,
    )
    const { matched } = matchTransfers(
      [log({ txHash: HASH_A, tokenAddress: exotic, from: USER, to: SOLVER.toLowerCase(), amountRaw: bn(123456789) })],
      expected,
      { solver: SOLVER },
    )
    expect(matched).toHaveLength(1)
  })

  it('consumes each ledger row once — a second identical transfer is anomalous', () => {
    const expected = expectedFromWalletTxs([
      { id: 'w1', type: 'activation_sweep', txHash: HASH_A, tokenAddress: NTZS, amount: '100', decimals: 18 },
    ])
    const transfer = log({ txHash: HASH_A, tokenAddress: NTZS, from: USER, to: SOLVER.toLowerCase(), amountRaw: NTZS_100 })
    const { matched, anomalies } = matchTransfers([transfer, { ...transfer, logIndex: 1 }], expected, { solver: SOLVER })
    expect(matched).toHaveLength(1)
    expect(anomalies).toEqual([expect.objectContaining({ kind: 'mismatched' })])
  })

  it('treats a solver self-transfer as inbound', () => {
    const { anomalies } = matchTransfers(
      [log({ txHash: HASH_C, from: SOLVER.toLowerCase(), to: SOLVER.toLowerCase() })],
      [],
      { solver: SOLVER },
    )
    expect(anomalies[0].direction).toBe('in')
  })
})

describe('evaluateInvariant', () => {
  it('flags the 23 Jul 2026 incident shape: claims exceed on-chain by 3,055.91 nTZS', () => {
    const claims = 10_000
    const result = evaluateInvariant({ claims, unsweptFee: 0, onChain: claims - 3055.91, tolerance: 50 })
    expect(result.status).toBe('deficit')
    expect(result.delta).toBeCloseTo(-3055.91, 6)
  })

  it('counts unswept protocol fees as backed, not surplus', () => {
    expect(evaluateInvariant({ claims: 1000, unsweptFee: 25, onChain: 1025, tolerance: 0.5 }).status).toBe('ok')
  })

  it('flags unattributed surplus and tolerates dust (strict beyond-tolerance)', () => {
    expect(evaluateInvariant({ claims: 1000, unsweptFee: 0, onChain: 1100, tolerance: 50 }).status).toBe('surplus')
    expect(evaluateInvariant({ claims: 1000, unsweptFee: 0, onChain: 950, tolerance: 50 }).status).toBe('ok')
    expect(evaluateInvariant({ claims: 1000, unsweptFee: 0, onChain: 949.99, tolerance: 50 }).status).toBe('deficit')
  })
})

describe('alertFingerprint', () => {
  it('is order-insensitive and magnitude-free', () => {
    const a = alertFingerprint(
      [{ chain: 'base', token: 'nTZS' }, { chain: 'bnb', token: 'USDT' }],
      [{ txHash: HASH_A, logIndex: 1 }, { txHash: HASH_B, logIndex: 0 }],
    )
    const b = alertFingerprint(
      [{ chain: 'bnb', token: 'USDT' }, { chain: 'base', token: 'nTZS' }],
      [{ txHash: HASH_B, logIndex: 0 }, { txHash: HASH_A, logIndex: 1 }],
    )
    expect(a).toBe(b)
  })

  it('changes when a new anomaly appears', () => {
    const before = alertFingerprint([{ chain: 'base', token: 'nTZS' }], [])
    const after = alertFingerprint([{ chain: 'base', token: 'nTZS' }], [{ txHash: HASH_C, logIndex: 0 }])
    expect(before).not.toBe(after)
  })
})
