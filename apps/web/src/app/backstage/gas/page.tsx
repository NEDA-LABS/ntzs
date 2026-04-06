import { ethers } from 'ethers'
import { requireAnyRole } from '@/lib/auth/rbac'
import { GasAddressCopy } from './_components/GasAddressCopy'

const BASE_MAINNET_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org'
const MINTER_PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY || ''
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || ''
const SOLVER_PRIVATE_KEY = process.env.SOLVER_PRIVATE_KEY || ''

const CRITICAL_THRESHOLD = 0.001
const LOW_THRESHOLD = 0.005

// Liquidity pool thresholds
const NTZS_LOW_THRESHOLD = 50_000
const NTZS_CRITICAL_THRESHOLD = 10_000
const USDC_LOW_THRESHOLD = 20
const USDC_CRITICAL_THRESHOLD = 5

const NTZS_CONTRACT = '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

const GAS_PRICE_ETH = 0.01 / 1e9
const MINT_GAS = 65000
const ETH_SEND_GAS = 21000
const TOP_UP_AMOUNT_ETH = 0.0005

type Status = 'ok' | 'low' | 'critical' | 'unconfigured'

function getStatus(ethBalance: number, configured: boolean): Status {
  if (!configured) return 'unconfigured'
  if (ethBalance < CRITICAL_THRESHOLD) return 'critical'
  if (ethBalance < LOW_THRESHOLD) return 'low'
  return 'ok'
}

function StatusBadge({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    ok: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20',
    low: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20',
    critical: 'bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/20',
    unconfigured: 'bg-zinc-500/15 text-zinc-400 ring-1 ring-zinc-500/20',
  }
  const labels: Record<Status, string> = {
    ok: 'Healthy',
    low: 'Low — Refill Soon',
    critical: 'Critical — Refill Now',
    unconfigured: 'Not Configured',
  }
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

function StatusDot({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    ok: 'bg-emerald-400',
    low: 'bg-amber-400 animate-pulse',
    critical: 'bg-rose-400 animate-pulse',
    unconfigured: 'bg-zinc-600',
  }
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${styles[status]}`} />
}

export default async function GasMonitorPage() {
  await requireAnyRole(['super_admin'])

  let minterAddress = ''
  let minterBalanceEth = 0
  let relayerAddress = ''
  let relayerBalanceEth = 0
  let solverAddress = ''
  let solverBalanceEth = 0
  let poolNtzs = 0
  let poolUsdc = 0
  let fetchError = ''

  try {
    const provider = new ethers.JsonRpcProvider(BASE_MAINNET_RPC_URL)

    if (MINTER_PRIVATE_KEY) {
      minterAddress = new ethers.Wallet(MINTER_PRIVATE_KEY).address
      const raw = await provider.getBalance(minterAddress)
      minterBalanceEth = parseFloat(ethers.formatEther(raw))
    }

    if (RELAYER_PRIVATE_KEY) {
      relayerAddress = new ethers.Wallet(RELAYER_PRIVATE_KEY).address
      const raw = await provider.getBalance(relayerAddress)
      relayerBalanceEth = parseFloat(ethers.formatEther(raw))
    }

    if (SOLVER_PRIVATE_KEY) {
      solverAddress = new ethers.Wallet(SOLVER_PRIVATE_KEY).address
      const raw = await provider.getBalance(solverAddress)
      solverBalanceEth = parseFloat(ethers.formatEther(raw))

      // Fetch solver pool token balances
      const ntzs = new ethers.Contract(NTZS_CONTRACT, ERC20_ABI, provider)
      const usdc = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, provider)
      const [ntzsRaw, usdcRaw] = await Promise.all([
        ntzs.balanceOf(solverAddress),
        usdc.balanceOf(solverAddress),
      ])
      poolNtzs = parseFloat(ethers.formatUnits(ntzsRaw, 18))
      poolUsdc = parseFloat(ethers.formatUnits(usdcRaw, 6))
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to fetch balances'
  }

  const minterStatus = getStatus(minterBalanceEth, !!MINTER_PRIVATE_KEY)
  const relayerStatus = getStatus(relayerBalanceEth, !!RELAYER_PRIVATE_KEY)
  const solverStatus = getStatus(solverBalanceEth, !!SOLVER_PRIVATE_KEY)

  const overallStatus: Status =
    minterStatus === 'critical' || relayerStatus === 'critical' || solverStatus === 'critical'
      ? 'critical'
      : minterStatus === 'low' || relayerStatus === 'low' || solverStatus === 'low'
      ? 'low'
      : 'ok'

  const minterOpsLeft = Math.floor(minterBalanceEth / (MINT_GAS * GAS_PRICE_ETH))
  const relayerOpsLeft = Math.floor(relayerBalanceEth / (ETH_SEND_GAS * GAS_PRICE_ETH + TOP_UP_AMOUNT_ETH))
  const solverOpsLeft = Math.floor(solverBalanceEth / (ETH_SEND_GAS * GAS_PRICE_ETH + TOP_UP_AMOUNT_ETH))

  const overallBanner: Record<Status, { bg: string; text: string; message: string }> = {
    ok: {
      bg: 'bg-emerald-500/10 border-emerald-500/20',
      text: 'text-emerald-400',
      message: 'All gas wallets are healthy. No action required.',
    },
    low: {
      bg: 'bg-amber-500/10 border-amber-500/20',
      text: 'text-amber-400',
      message: 'One or more wallets are running low. Top up soon to avoid service interruptions.',
    },
    critical: {
      bg: 'bg-rose-500/10 border-rose-500/20',
      text: 'text-rose-400',
      message: 'One or more wallets are critically low. Minting or transfers may be failing right now.',
    },
    unconfigured: {
      bg: 'bg-zinc-500/10 border-zinc-500/20',
      text: 'text-zinc-400',
      message: 'Wallet keys not configured.',
    },
  }

  const banner = overallBanner[overallStatus]

  const wallets = [
    {
      role: 'Minter',
      description: 'Signs mint() transactions when deposits are approved',
      address: minterAddress,
      balance: minterBalanceEth,
      status: minterStatus,
      opsLeft: minterOpsLeft,
      opsLabel: 'mint transactions',
      opCost: `~${(MINT_GAS * GAS_PRICE_ETH * 1e6).toFixed(3)} µETH / mint`,
      configured: !!MINTER_PRIVATE_KEY,
    },
    {
      role: 'Relayer',
      description: 'Tops up user HD wallets with gas before transfers',
      address: relayerAddress,
      balance: relayerBalanceEth,
      status: relayerStatus,
      opsLeft: relayerOpsLeft,
      opsLabel: 'user wallet top-ups',
      opCost: `~${TOP_UP_AMOUNT_ETH} ETH / top-up`,
      configured: !!RELAYER_PRIVATE_KEY,
    },
    {
      role: 'Solver (LP Pool)',
      description: 'Executes swaps and auto-refills user gas during swaps',
      address: solverAddress,
      balance: solverBalanceEth,
      status: solverStatus,
      opsLeft: solverOpsLeft,
      opsLabel: 'swap gas top-ups',
      opCost: `~${TOP_UP_AMOUNT_ETH} ETH / top-up`,
      configured: !!SOLVER_PRIVATE_KEY,
    },
  ]

  return (
    <div className="min-h-screen bg-black px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-500/10 p-2.5">
            <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Gas Monitor</h1>
            <p className="text-sm text-zinc-500">
              Live ETH balances for platform hot wallets on Base mainnet
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <StatusDot status={overallStatus} />
            <StatusBadge status={overallStatus} />
          </div>
        </div>
      </div>

      {/* Overall Alert Banner */}
      {!fetchError && (
        <div className={`mb-6 rounded-xl border px-5 py-4 ${banner.bg}`}>
          <p className={`text-sm font-medium ${banner.text}`}>{banner.message}</p>
          {overallStatus !== 'ok' && (
            <p className="mt-1 text-xs text-zinc-500">
              Send ETH to the wallet address(es) below on Base mainnet. A minimum of 0.01 ETH per wallet is recommended.
            </p>
          )}
        </div>
      )}

      {fetchError && (
        <div className="mb-6 rounded-xl border border-rose-500/20 bg-rose-500/10 px-5 py-4">
          <p className="text-sm font-medium text-rose-400">Failed to fetch balances</p>
          <p className="mt-1 font-mono text-xs text-zinc-500">{fetchError}</p>
        </div>
      )}

      {/* Wallet Cards */}
      <div className="grid gap-5 lg:grid-cols-2">
        {wallets.map((w) => (
          <div key={w.role} className="rounded-2xl border border-white/[0.07] bg-zinc-950 overflow-hidden">
            {/* Card header */}
            <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
              <div>
                <p className="text-sm font-semibold text-white">{w.role} Wallet</p>
                <p className="mt-0.5 text-xs text-zinc-500">{w.description}</p>
              </div>
              <StatusBadge status={w.status} />
            </div>

            <div className="p-6 space-y-5">
              {/* Balance */}
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-600 mb-1">
                  Current Balance
                </p>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-bold tabular-nums ${
                    w.status === 'critical' ? 'text-rose-400'
                    : w.status === 'low' ? 'text-amber-400'
                    : 'text-white'
                  }`}>
                    {w.configured ? w.balance.toFixed(6) : '—'}
                  </span>
                  {w.configured && (
                    <span className="text-sm text-zinc-500">ETH</span>
                  )}
                </div>
                {w.configured && (
                  <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
                    <span>
                      Low threshold: <span className="text-zinc-400">{LOW_THRESHOLD} ETH</span>
                    </span>
                    <span>
                      Critical threshold: <span className="text-zinc-400">{CRITICAL_THRESHOLD} ETH</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Capacity */}
              {w.configured && (
                <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-zinc-500">Estimated capacity remaining</p>
                    <p className={`text-sm font-semibold tabular-nums ${
                      w.opsLeft < 10 ? 'text-rose-400'
                      : w.opsLeft < 50 ? 'text-amber-400'
                      : 'text-emerald-400'
                    }`}>
                      {w.opsLeft.toLocaleString()} {w.opsLabel}
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-700">{w.opCost} at 0.01 gwei (conservative)</p>
                </div>
              )}

              {/* Address */}
              {w.configured ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
                    Wallet Address
                  </p>
                  <GasAddressCopy address={w.address} />
                  <p className="mt-2 text-[11px] text-zinc-600">
                    Send ETH to this address on Base mainnet to top up
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3">
                  <p className="text-xs text-zinc-500">
                    {w.role === 'Minter' ? 'MINTER_PRIVATE_KEY' : 'RELAYER_PRIVATE_KEY'} is not set in environment
                  </p>
                </div>
              )}

              {/* Faucet link */}
              {w.configured && w.status !== 'ok' && (
                <a
                  href={`https://basescan.org/address/${w.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/15"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  View on BaseScan
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Liquidity Pool Monitor */}
      {!!SOLVER_PRIVATE_KEY && (
        <div className="mt-6 rounded-2xl border border-white/[0.07] bg-zinc-950 overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
            <div>
              <p className="text-sm font-semibold text-white">Liquidity Pool (Solver)</p>
              <p className="mt-0.5 text-xs text-zinc-500">Token balances available for swaps</p>
            </div>
            <StatusBadge status={
              poolUsdc < USDC_CRITICAL_THRESHOLD || poolNtzs < NTZS_CRITICAL_THRESHOLD ? 'critical'
              : poolUsdc < USDC_LOW_THRESHOLD || poolNtzs < NTZS_LOW_THRESHOLD ? 'low'
              : 'ok'
            } />
          </div>
          <div className="p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              {/* nTZS balance */}
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-600 mb-1">nTZS Balance</p>
                <div className="flex items-baseline gap-2">
                  <span className={`text-2xl font-bold tabular-nums ${
                    poolNtzs < NTZS_CRITICAL_THRESHOLD ? 'text-rose-400'
                    : poolNtzs < NTZS_LOW_THRESHOLD ? 'text-amber-400'
                    : 'text-white'
                  }`}>
                    {poolNtzs.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-sm text-zinc-500">nTZS</span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-600">
                  Handles USDC → nTZS swaps · Low: {NTZS_LOW_THRESHOLD.toLocaleString()} · Critical: {NTZS_CRITICAL_THRESHOLD.toLocaleString()}
                </p>
                {poolNtzs < NTZS_LOW_THRESHOLD && (
                  <p className={`mt-2 text-xs font-medium ${poolNtzs < NTZS_CRITICAL_THRESHOLD ? 'text-rose-400' : 'text-amber-400'}`}>
                    {poolNtzs < NTZS_CRITICAL_THRESHOLD
                      ? 'Users buying nTZS will be rejected. Mint more nTZS to solver.'
                      : 'Running low. Consider minting more nTZS to solver.'}
                  </p>
                )}
              </div>

              {/* USDC balance */}
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-600 mb-1">USDC Balance</p>
                <div className="flex items-baseline gap-2">
                  <span className={`text-2xl font-bold tabular-nums ${
                    poolUsdc < USDC_CRITICAL_THRESHOLD ? 'text-rose-400'
                    : poolUsdc < USDC_LOW_THRESHOLD ? 'text-amber-400'
                    : 'text-white'
                  }`}>
                    {poolUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-sm text-zinc-500">USDC</span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-600">
                  Handles nTZS → USDC swaps · Low: ${USDC_LOW_THRESHOLD} · Critical: ${USDC_CRITICAL_THRESHOLD}
                </p>
                {poolUsdc < USDC_LOW_THRESHOLD && (
                  <p className={`mt-2 text-xs font-medium ${poolUsdc < USDC_CRITICAL_THRESHOLD ? 'text-rose-400' : 'text-amber-400'}`}>
                    {poolUsdc < USDC_CRITICAL_THRESHOLD
                      ? 'Users selling nTZS will be rejected. Send USDC to solver.'
                      : 'Running low. Consider sending more USDC to solver.'}
                  </p>
                )}
              </div>
            </div>

            {/* Swap capacity estimate */}
            <div className="mt-4 rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3">
              <p className="text-xs font-medium text-zinc-500 mb-2">Estimated Swap Capacity</p>
              <div className="grid gap-2 sm:grid-cols-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">nTZS → USDC (1,000 nTZS each)</span>
                  <span className={`font-semibold tabular-nums ${
                    Math.floor(poolUsdc / 0.38) < 10 ? 'text-rose-400'
                    : Math.floor(poolUsdc / 0.38) < 50 ? 'text-amber-400'
                    : 'text-emerald-400'
                  }`}>
                    ~{Math.floor(poolUsdc / 0.38).toLocaleString()} swaps
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">USDC → nTZS ($1 USDC each)</span>
                  <span className={`font-semibold tabular-nums ${
                    Math.floor(poolNtzs / 2610) < 10 ? 'text-rose-400'
                    : Math.floor(poolNtzs / 2610) < 50 ? 'text-amber-400'
                    : 'text-emerald-400'
                  }`}>
                    ~{Math.floor(poolNtzs / 2610).toLocaleString()} swaps
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Thresholds Reference */}
      <div className="mt-6 rounded-2xl border border-white/[0.07] bg-zinc-950 p-6">
        <p className="text-sm font-semibold text-white mb-4">Threshold Reference</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Healthy', color: 'emerald', desc: `>= ${LOW_THRESHOLD} ETH — operations running normally` },
            { label: 'Low', color: 'amber', desc: `${CRITICAL_THRESHOLD}–${LOW_THRESHOLD} ETH — plan to refill within 24 hours` },
            { label: 'Critical', color: 'rose', desc: `< ${CRITICAL_THRESHOLD} ETH — operations likely failing right now` },
          ].map((t) => (
            <div key={t.label} className="flex items-start gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
              <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-${t.color}-400`} />
              <div>
                <p className={`text-xs font-semibold text-${t.color}-400`}>{t.label}</p>
                <p className="mt-0.5 text-xs text-zinc-500">{t.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
