import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits } from 'ethers'

import { getDb } from '@/lib/db'
import { lpFills, fxFeeSweeps } from '@ntzs/db'
import {
  BASE_RPC_URL,
  PLATFORM_TREASURY_ADDRESS,
  FX_SWEEP_MIN_NTZS,
  FX_SWEEP_MIN_STABLE,
} from '@/lib/env'

const CRON_SECRET = process.env.CRON_SECRET || ''

export const maxDuration = 60

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]

// Tokens the sweep cron watches on Base
const SWEEP_TOKENS = [
  { symbol: 'nTZS',  address: '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688', decimals: 18 },
  { symbol: 'USDC',  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6  },
  { symbol: 'USDT',  address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6  },
]

/**
 * GET /api/cron/fx-fee-sweep
 *
 * Runs daily. For each token, calculates:
 *   pending = SUM(lp_fills.protocol_fee_earned) − SUM(fx_fee_sweeps.amount)
 * If pending exceeds the configured minimum, transfers from solver → treasury
 * and records the sweep in fx_fee_sweeps.
 *
 * Safe to re-run: each sweep is recorded atomically so double-runs are no-ops.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const isVercelCron = request.headers.get('x-vercel-cron') === '1'

  if (CRON_SECRET && !isVercelCron && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!PLATFORM_TREASURY_ADDRESS) {
    return NextResponse.json({ error: 'PLATFORM_TREASURY_ADDRESS not configured' }, { status: 503 })
  }

  const solverPrivateKey = process.env.SOLVER_PRIVATE_KEY as `0x${string}` | undefined
  if (!solverPrivateKey) {
    return NextResponse.json({ error: 'SOLVER_PRIVATE_KEY not configured' }, { status: 503 })
  }

  const { db, sql: rawSql } = getDb()
  const provider = new JsonRpcProvider(BASE_RPC_URL)
  const solverWallet = new Wallet(solverPrivateKey, provider)

  // Serialize sweeps so overlapping cron invocations can't both read the same
  // `pending` and double-transfer — which would move LP capital (not just earned
  // fees) into the treasury. Session advisory lock on a reserved connection so
  // the lock/unlock run on the same pooled connection; skip if already held.
  const reserved = await rawSql.reserve()
  const [{ locked }] = await reserved<{ locked: boolean }[]>`
    select pg_try_advisory_lock(hashtext('fx_fee_sweep')) as locked
  `
  if (!locked) {
    reserved.release()
    return NextResponse.json({ ok: true, skipped: 'another sweep already running' })
  }

  try {
  const results: Array<{ token: string; pending: number; swept: boolean; txHash?: string; reason?: string }> = []

  for (const token of SWEEP_TOKENS) {
    const addr = token.address.toLowerCase()
    const minThreshold = token.symbol === 'nTZS' ? FX_SWEEP_MIN_NTZS : FX_SWEEP_MIN_STABLE

    // Total earned across all fills for this token
    const [earned] = await db
      .select({
        total: sql<string>`coalesce(sum(${lpFills.protocolFeeEarned}), '0')`,
      })
      .from(lpFills)
      .where(sql`lower(${lpFills.toToken}) = ${addr}`)

    // Total already swept for this token
    const [swept] = await db
      .select({
        total: sql<string>`coalesce(sum(${fxFeeSweeps.amount}), '0')`,
      })
      .from(fxFeeSweeps)
      .where(sql`lower(${fxFeeSweeps.tokenAddress}) = ${addr}`)

    const pending = parseFloat(earned.total) - parseFloat(swept.total)

    if (pending < minThreshold) {
      results.push({ token: token.symbol, pending, swept: false, reason: 'below threshold' })
      continue
    }

    // Verify solver has enough balance (double-check against actual chain state)
    const contract = new Contract(token.address, ERC20_ABI, provider)
    const solverBalance: bigint = await contract.balanceOf(solverWallet.address)
    const pendingUnits = parseUnits(pending.toFixed(token.decimals), token.decimals)

    if (solverBalance < pendingUnits) {
      const have = parseFloat(formatUnits(solverBalance, token.decimals))
      results.push({ token: token.symbol, pending, swept: false, reason: `solver balance insufficient (have ${have.toFixed(4)})` })
      continue
    }

    // Execute the transfer
    const connectedContract = contract.connect(solverWallet) as typeof contract
    const tx = await (connectedContract as unknown as {
      transfer: (to: string, amount: bigint) => Promise<{ hash: string; wait: () => Promise<unknown> }>
    }).transfer(PLATFORM_TREASURY_ADDRESS, pendingUnits)

    await tx.wait()

    // Record the sweep
    await db.insert(fxFeeSweeps).values({
      chain: 'base',
      tokenAddress: token.address,
      tokenSymbol: token.symbol,
      amount: pending.toFixed(token.decimals),
      txHash: tx.hash,
      treasuryAddress: PLATFORM_TREASURY_ADDRESS,
    })

    results.push({ token: token.symbol, pending, swept: true, txHash: tx.hash })
    console.log(`[fx-fee-sweep] ${token.symbol}: swept ${pending.toFixed(4)} → treasury (${tx.hash})`)
  }

  return NextResponse.json({ ok: true, results })
  } finally {
    await reserved`select pg_advisory_unlock(hashtext('fx_fee_sweep'))`.catch(() => {})
    reserved.release()
  }
}
