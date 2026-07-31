import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { and, eq, ilike } from 'drizzle-orm'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { partners, partnerKyb, partnerSubWallets, lpFxPairs, lpAccounts } from '@ntzs/db'
import { hasCapability } from '@/lib/platform/capabilities'
import { deriveSubWalletAddress } from '@/lib/waas/hd-wallets'
import { RAMP_SETTLEMENT_LABEL, USDC_BASE } from '@/lib/ramp/wallet'
import { rampSpendEnabled } from '@/lib/ramp/quote'
import { spendKindEnabled } from '@/lib/waas/spend-quote'
import { SWAP_TOKENS } from '@/lib/fx/swap'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE, MINTER_PRIVATE_KEY, BURNER_PRIVATE_KEY } from '@/lib/env'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ERC20_BAL = ['function balanceOf(address) view returns (uint256)'] as const

/**
 * GET /api/admin/ramp-readiness?partner=<uuid | name fragment>
 *
 * Browser-friendly super-admin probe (same pattern as selcom-lookup-probe):
 * answers, from evidence, "why can this partner not ramp?" in one click.
 *
 * A live partner reported bare 500s on the ramp with a live key, and nothing
 * in the API surface could say which precondition was missing — partner
 * provisioning (HD seed), market config (USDC/nTZS pair, LP), solver
 * inventory, executor env, or flags. This walks every precondition in the
 * order the money path hits them and returns an ordered blocker list.
 *
 * Read-only, and reports env vars only as present/absent booleans — never
 * values.
 */
export async function GET(request: NextRequest) {
  await requireAnyRole(['super_admin'])

  const q = request.nextUrl.searchParams.get('partner')?.trim()
  if (!q) {
    return NextResponse.json({ error: 'partner query param required — a partner uuid or a name fragment' }, { status: 400 })
  }

  const { db } = getDb()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)
  const matches = await db
    .select({
      id: partners.id, name: partners.name, mode: partners.mode,
      capabilities: partners.capabilities, encryptedHdSeed: partners.encryptedHdSeed,
    })
    .from(partners)
    .where(isUuid ? eq(partners.id, q) : ilike(partners.name, `%${q}%`))
    .limit(5)

  if (matches.length === 0) return NextResponse.json({ error: `No partner matches '${q}'` }, { status: 404 })
  if (matches.length > 1) {
    return NextResponse.json({
      error: 'Ambiguous — pass the uuid',
      candidates: matches.map((m) => ({ id: m.id, name: m.name, mode: m.mode })),
    }, { status: 400 })
  }
  const p = matches[0]

  const blockers: string[] = []
  const note = (cond: boolean, msg: string) => { if (cond) blockers.push(msg) }

  // ── Identity & authorization (what requireRampPartner checks) ─────────────
  const [kyb] = await db.select({ status: partnerKyb.status }).from(partnerKyb).where(eq(partnerKyb.partnerId, p.id)).limit(1)
  const rampCapability = hasCapability(p.capabilities ?? null, 'ramp')
  note(p.mode !== 'live', `partner mode is '${p.mode}' — ramp refuses test keys (501)`)
  note(!rampCapability, "capabilities do not include 'ramp' — every ramp call returns 403")
  note(!kyb || kyb.status !== 'approved', `KYB status is '${kyb?.status ?? 'missing'}' — every ramp call returns 403`)

  // ── Provisioning (what /ramp/balance and offramp need) ────────────────────
  const seedPresent = Boolean(p.encryptedHdSeed)
  let seedDerives = false
  let deriveError: string | undefined
  if (seedPresent) {
    try {
      deriveSubWalletAddress(p.encryptedHdSeed as string, 0)
      seedDerives = true
    } catch (e) {
      deriveError = e instanceof Error ? e.message : String(e)
    }
  }
  note(!seedPresent, 'no encrypted HD seed on the partner row — /ramp/balance returns ramp_not_provisioned; off-ramps refuse')
  note(seedPresent && !seedDerives, `HD seed present but does not decrypt (${deriveError ?? 'unknown'}) — check the seed encryption env on this deployment`)

  const [wallet] = await db
    .select({ address: partnerSubWallets.address, walletIndex: partnerSubWallets.walletIndex })
    .from(partnerSubWallets)
    .where(and(eq(partnerSubWallets.partnerId, p.id), eq(partnerSubWallets.label, RAMP_SETTLEMENT_LABEL)))
    .limit(1)

  // ── Market config (what the quote needs) ──────────────────────────────────
  const USDC = SWAP_TOKENS.USDC.address.toLowerCase()
  const NTZS = SWAP_TOKENS.NTZS.address.toLowerCase()
  const activePairs = await db.select().from(lpFxPairs).where(eq(lpFxPairs.isActive, true)).limit(10)
  const pair = activePairs.find((x) => {
    const t1 = x.token1Address.toLowerCase(), t2 = x.token2Address.toLowerCase()
    return (x.chain ?? 'base') === 'base' && (t1 === USDC || t2 === USDC) && (t1 === NTZS || t2 === NTZS)
  })
  const activeLps = await db
    .select({ id: lpAccounts.id, bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps })
    .from(lpAccounts)
    .where(eq(lpAccounts.isActive, true))
  note(!pair, "no ACTIVE USDC/nTZS pair on Base in lp_fx_pairs — every quote returns 'No active USDC/nTZS pair configured'. Configure it in /backstage/simplefx")
  note(activeLps.length === 0, 'no active LP account — off-ramps fail with "No active liquidity provider available". Activate one in /backstage/simplefx')

  // ── Executor env (what the settlement engine needs) ───────────────────────
  const executor = {
    solverPrivateKeySet: Boolean(process.env.SOLVER_PRIVATE_KEY),
    burnerKeySet: Boolean(BURNER_PRIVATE_KEY || MINTER_PRIVATE_KEY),
    rpcUrlSet: Boolean(BASE_RPC_URL),
    ntzsContractSet: Boolean(NTZS_CONTRACT_ADDRESS_BASE),
  }
  note(!executor.solverPrivateKeySet, "SOLVER_PRIVATE_KEY is not set — off-ramps fail with 'Ramp executor not configured'")
  note(!executor.burnerKeySet, "no burner/minter key set — off-ramps fail with 'Ramp executor not configured'")
  note(!executor.rpcUrlSet, 'BASE_RPC_URL is not set')
  note(!executor.ntzsContractSet, 'NTZS_CONTRACT_ADDRESS_BASE is not set')

  // ── On-chain balances (float + solver inventory) ──────────────────────────
  const solverAddress = process.env.SOLVER_WALLET_ADDRESS ?? '0xf4766439DC70f5B943Cc1918747b408b612ba646'
  let usdcFloat: string | null = null
  let solverNtzs: string | null = null
  let solverUsdc: string | null = null
  let rpcError: string | undefined
  if (executor.rpcUrlSet) {
    try {
      const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
      const usdcC = new ethers.Contract(USDC_BASE.address, ERC20_BAL, provider)
      const ntzsC = new ethers.Contract(SWAP_TOKENS.NTZS.address, ERC20_BAL, provider)
      if (wallet) usdcFloat = ethers.formatUnits(await usdcC.balanceOf(wallet.address), USDC_BASE.decimals)
      solverNtzs = ethers.formatUnits(await ntzsC.balanceOf(solverAddress), SWAP_TOKENS.NTZS.decimals)
      solverUsdc = ethers.formatUnits(await usdcC.balanceOf(solverAddress), USDC_BASE.decimals)
    } catch (e) {
      rpcError = e instanceof Error ? e.message : String(e)
      blockers.push(`RPC reads failed (${rpcError}) — balances unknown; the same failure breaks live settlements`)
    }
  }
  note(solverNtzs !== null && Number(solverNtzs) <= 0, 'solver wallet holds no nTZS — off-ramp swaps have no inventory to fill against (quotes will refuse on lowLiquidity)')
  note(wallet != null && usdcFloat !== null && Number(usdcFloat) <= 0, "partner's USDC float is 0 — quotes work, but off-ramps fail with 'Insufficient USDC float' until the partner funds their settlement address")

  // ── Flags (lipa/bill destinations only) ───────────────────────────────────
  const flags = {
    rampSpendEnabled: rampSpendEnabled(),
    lipaRailEnabled: spendKindEnabled('lipa'),
    billRailEnabled: spendKindEnabled('bill'),
  }
  note(!flags.rampSpendEnabled, 'RAMP_SPEND_ENABLED is not true on this deployment — lipa/bill off-ramp destinations return 503 (wallet payouts unaffected)')
  note(flags.rampSpendEnabled && !flags.lipaRailEnabled, "the lipa rail flag is off — lipa destinations return 'spend_kind_disabled'")

  return NextResponse.json({
    partner: { id: p.id, name: p.name, mode: p.mode, rampCapability, kybStatus: kyb?.status ?? null },
    provisioning: {
      encryptedHdSeedPresent: seedPresent,
      seedDerives,
      ...(deriveError ? { deriveError } : {}),
      settlementWallet: wallet ? { address: wallet.address, walletIndex: wallet.walletIndex } : null,
      usdcFloatBalance: usdcFloat,
    },
    market: pair
      ? { usdcNtzsPairActive: true, midRate: Number(pair.midRate), pairUpdatedAt: pair.updatedAt ?? null, activeLpCount: activeLps.length }
      : { usdcNtzsPairActive: false, activeLpCount: activeLps.length },
    solver: { address: solverAddress, ntzsBalance: solverNtzs, usdcBalance: solverUsdc },
    executor,
    flags,
    blockers,
    conclusion:
      blockers.length === 0
        ? 'READY — every precondition for quote and off-ramp passes. If the partner still errors, capture their requestId from the ramp_unavailable body and check the function logs.'
        : `NOT READY — ${blockers.length} blocker(s), listed in the order the money path hits them. Fix the first one first.`,
  })
}
