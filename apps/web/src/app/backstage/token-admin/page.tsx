'use client'

import { useMemo, useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { useSearchParams } from 'next/navigation'

type Action =
  | 'pause'
  | 'unpause'
  | 'freeze'
  | 'unfreeze'
  | 'blacklist'
  | 'unblacklist'
  | 'wipeBlacklisted'

type Chain = 'base_sepolia' | 'base' | 'bnb'

const CHAIN_CONFIG: Record<Chain, { label: string; chainId: string; rpcUrl: string; explorer: string }> = {
  base_sepolia: {
    label: 'Base Sepolia (Testnet)',
    chainId: '84532',
    rpcUrl: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
  },
  base: {
    label: 'Base Mainnet',
    chainId: '8453',
    rpcUrl: 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
  },
  bnb: {
    label: 'BNB Smart Chain',
    chainId: '56',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    explorer: 'https://bscscan.com',
  },
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
    </svg>
  )
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
    </svg>
  )
}

function FreezeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>
  )
}

function UnlockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  )
}

function BlockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  )
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  )
}

const actions: { value: Action; label: string; icon: React.ReactNode; description: string; needsAddress: boolean; danger?: boolean }[] = [
  { value: 'pause', label: 'Pause Contract', icon: <PauseIcon className="h-5 w-5" />, description: 'Halt all token transfers', needsAddress: false, danger: true },
  { value: 'unpause', label: 'Unpause Contract', icon: <PlayIcon className="h-5 w-5" />, description: 'Resume token transfers', needsAddress: false },
  { value: 'freeze', label: 'Freeze Account', icon: <FreezeIcon className="h-5 w-5" />, description: 'Prevent account from sending', needsAddress: true },
  { value: 'unfreeze', label: 'Unfreeze Account', icon: <UnlockIcon className="h-5 w-5" />, description: 'Allow account to send again', needsAddress: true },
  { value: 'blacklist', label: 'Blacklist Account', icon: <BlockIcon className="h-5 w-5" />, description: 'Block all transfers', needsAddress: true, danger: true },
  { value: 'unblacklist', label: 'Remove Blacklist', icon: <CheckCircleIcon className="h-5 w-5" />, description: 'Remove from blacklist', needsAddress: true },
  { value: 'wipeBlacklisted', label: 'Wipe Balance', icon: <TrashIcon className="h-5 w-5" />, description: 'Burn blacklisted balance', needsAddress: true, danger: true },
]

export default function TokenAdminPage() {
  const safeAdmin = process.env.NEXT_PUBLIC_NTZS_SAFE_ADMIN || ''

  const searchParams = useSearchParams()

  const [selectedChain, setSelectedChain] = useState<Chain>('base_sepolia')
  const [selectedAction, setSelectedAction] = useState<Action>('pause')
  const [account, setAccount] = useState('')
  const [copied, setCopied] = useState(false)
  const [contractState, setContractState] = useState<{
    paused: boolean | null
    totalSupply: string | null
    loading: boolean
  }>({ paused: null, totalSupply: null, loading: false })

  const chainConfig = CHAIN_CONFIG[selectedChain]

  // Allow deep-linking from admin tables (e.g., /backstage/token-admin?chain=base_sepolia&action=freeze&account=0x...)
  useEffect(() => {
    const qpChain = searchParams.get('chain')
    const qpAction = searchParams.get('action')
    const qpAccount = searchParams.get('account')

    if (qpChain && Object.keys(CHAIN_CONFIG).includes(qpChain)) {
      setSelectedChain(qpChain as Chain)
    }
    if (qpAction && actions.some((a) => a.value === qpAction)) {
      setSelectedAction(qpAction as Action)
    }
    if (qpAccount && ethers.isAddress(qpAccount)) {
      setAccount(qpAccount)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const contractAddress = useMemo(() => {
    if (selectedChain === 'base_sepolia') return process.env.NEXT_PUBLIC_NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA || ''
    if (selectedChain === 'base') return process.env.NEXT_PUBLIC_NTZS_CONTRACT_ADDRESS_BASE || ''
    if (selectedChain === 'bnb') return process.env.NEXT_PUBLIC_NTZS_CONTRACT_ADDRESS_BNB || ''
    return ''
  }, [selectedChain])

  const explorerUrl = useMemo(() => {
    if (!contractAddress || !ethers.isAddress(contractAddress)) return ''
    return `${chainConfig.explorer}/address/${contractAddress}`
  }, [contractAddress, chainConfig.explorer])

  // Fetch contract state (paused, total supply)
  useEffect(() => {
    if (!contractAddress || !ethers.isAddress(contractAddress)) return

    const fetchState = async () => {
      setContractState(prev => ({ ...prev, loading: true }))
      try {
        const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl)
        const token = new ethers.Contract(
          contractAddress,
          [
            'function paused() view returns (bool)',
            'function totalSupply() view returns (uint256)',
            'function decimals() view returns (uint8)',
          ],
          provider
        )

        const [paused, totalSupply, decimals] = await Promise.all([
          token.paused().catch(() => null),
          token.totalSupply().catch(() => null),
          token.decimals().catch(() => 18),
        ])

        const formattedSupply = totalSupply !== null
          ? ethers.formatUnits(totalSupply, decimals)
          : null

        setContractState({ paused, totalSupply: formattedSupply, loading: false })
      } catch {
        setContractState({ paused: null, totalSupply: null, loading: false })
      }
    }

    fetchState()
  }, [contractAddress, chainConfig.rpcUrl])

  const iface = useMemo(() => {
    return new ethers.Interface([
      'function pause()',
      'function unpause()',
      'function freeze(address account)',
      'function unfreeze(address account)',
      'function blacklist(address account)',
      'function unblacklist(address account)',
      'function wipeBlacklisted(address account)',
    ])
  }, [])

  const currentActionConfig = actions.find(a => a.value === selectedAction)

  const { to, data, error } = useMemo(() => {
    const to = contractAddress

    try {
      if (!contractAddress) {
        return { to: '', data: '', error: 'Contract address not configured' }
      }
      if (!ethers.isAddress(to)) {
        return { to, data: '', error: 'Invalid contract address' }
      }

      if (currentActionConfig?.needsAddress) {
        if (!account) {
          return { to, data: '', error: 'Enter target wallet address' }
        }
        if (!ethers.isAddress(account)) {
          return { to, data: '', error: 'Invalid wallet address format' }
        }
        return {
          to,
          data: iface.encodeFunctionData(selectedAction, [account]),
          error: '',
        }
      }

      return {
        to,
        data: iface.encodeFunctionData(selectedAction, []),
        error: '',
      }
    } catch (e) {
      return {
        to,
        data: '',
        error: e instanceof Error ? e.message : 'Failed to encode calldata',
      }
    }
  }, [account, selectedAction, contractAddress, iface, currentActionConfig])

  const safeTxJson = useMemo(() => {
    if (!to || !data) return ''

    return JSON.stringify(
      {
        version: '1.0',
        chainId: chainConfig.chainId,
        createdAt: new Date().toISOString(),
        meta: {
          name: 'nTZS Admin Action',
          description: selectedAction,
        },
        transactions: [
          {
            to,
            value: '0',
            data,
          },
        ],
      },
      null,
      2
    )
  }, [selectedAction, chainConfig.chainId, data, to])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(safeTxJson)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-white/10 bg-zinc-950/50">
        <div className="px-8 py-6">
          <h1 className="text-2xl font-bold text-white">Token Admin</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Generate Safe-ready calldata for on-chain nTZS token administration
          </p>
        </div>
      </div>

      <div className="p-8">
        {/* Chain Selector */}
        <div className="mb-6">
          <label className="text-sm font-medium text-zinc-400">Select Chain</label>
          <div className="mt-2 flex gap-2">
            {(Object.keys(CHAIN_CONFIG) as Chain[]).map((chain) => (
              <button
                key={chain}
                onClick={() => setSelectedChain(chain)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
                  selectedChain === chain
                    ? 'border-violet-500/50 bg-violet-500/10 text-white'
                    : 'border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:text-white'
                }`}
              >
                {CHAIN_CONFIG[chain].label}
              </button>
            ))}
          </div>
        </div>

        {/* Contract Info Bar */}
        <div className="mb-8 grid gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-500/10 p-2.5">
                <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-zinc-500">Contract</p>
                <p className="truncate font-mono text-sm text-white" title={contractAddress}>
                  {contractAddress || 'Not configured'}
                </p>
                {explorerUrl && (
                  <a href={explorerUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300">
                    View on Explorer →
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-violet-500/10 p-2.5">
                <svg className="h-5 w-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-zinc-500">Safe Admin</p>
                <p className="truncate font-mono text-sm text-white" title={safeAdmin}>
                  {safeAdmin || 'Not configured'}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2.5">
                <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-500">Chain</p>
                <p className="font-mono text-sm text-white">{chainConfig.label}</p>
              </div>
            </div>
          </div>

          {/* Contract State */}
          <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
            <div className="flex items-center gap-3">
              <div className={`rounded-lg p-2.5 ${contractState.paused ? 'bg-rose-500/10' : 'bg-emerald-500/10'}`}>
                {contractState.paused ? (
                  <PauseIcon className="h-5 w-5 text-rose-400" />
                ) : (
                  <PlayIcon className="h-5 w-5 text-emerald-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-zinc-500">Contract State</p>
                {contractState.loading ? (
                  <p className="text-sm text-zinc-400">Loading...</p>
                ) : contractState.paused === null ? (
                  <p className="text-sm text-zinc-500">Unable to fetch</p>
                ) : (
                  <>
                    <p className={`text-sm font-medium ${contractState.paused ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {contractState.paused ? 'PAUSED' : 'ACTIVE'}
                    </p>
                    {contractState.totalSupply && (
                      <p className="text-xs text-zinc-500">
                        Supply: {Number(contractState.totalSupply).toLocaleString()} nTZS
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-5">
          {/* Action Selection - Left Side */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-6">
              <h2 className="text-lg font-semibold text-white">Select Action</h2>
              <p className="mt-1 text-sm text-zinc-500">Choose an admin operation to perform</p>

              <div className="mt-6 space-y-2">
                {actions.map((action) => (
                  <button
                    key={action.value}
                    onClick={() => setSelectedAction(action.value)}
                    className={`w-full rounded-xl border p-4 text-left transition-all ${
                      selectedAction === action.value
                        ? 'border-violet-500/50 bg-violet-500/10'
                        : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`${action.danger ? 'text-rose-400' : selectedAction === action.value ? 'text-violet-400' : 'text-zinc-400'}`}>
                        {action.icon}
                      </div>
                      <div>
                        <p className={`font-medium ${selectedAction === action.value ? 'text-white' : 'text-zinc-300'}`}>
                          {action.label}
                        </p>
                        <p className="text-xs text-zinc-500">{action.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {currentActionConfig?.needsAddress && (
                <div className="mt-6">
                  <label className="text-sm font-medium text-zinc-300">Target Wallet Address</label>
                  <input
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder="0x..."
                    className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Transaction Output - Right Side */}
          <div className="lg:col-span-3 space-y-6">
            {/* Error Message */}
            {error && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4">
                <div className="flex items-center gap-3">
                  <svg className="h-5 w-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <p className="text-sm text-rose-400">{error}</p>
                </div>
              </div>
            )}

            {/* Transaction Payload Card */}
            <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-6">
              <h2 className="text-lg font-semibold text-white">Transaction Payload</h2>
              <p className="mt-1 text-sm text-zinc-500">Use this data in your Safe Transaction Builder</p>

              <div className="mt-6 space-y-4">
                <div className="rounded-xl border border-white/5 bg-black/30 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">TO</span>
                  </div>
                  <p className="mt-2 break-all font-mono text-sm text-emerald-400">{to || '—'}</p>
                </div>

                <div className="rounded-xl border border-white/5 bg-black/30 p-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">VALUE</span>
                  <p className="mt-2 font-mono text-sm text-white">0</p>
                </div>

                <div className="rounded-xl border border-white/5 bg-black/30 p-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">DATA</span>
                  <p className="mt-2 break-all font-mono text-sm text-amber-400">{data || '—'}</p>
                </div>
              </div>
            </div>

            {/* Safe TX JSON */}
            <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Safe Transaction JSON</h2>
                  <p className="mt-1 text-sm text-zinc-500">Copy and paste into Safe Transaction Builder</p>
                </div>
                <button
                  onClick={handleCopy}
                  disabled={!safeTxJson}
                  className="flex items-center gap-2 rounded-lg bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-400 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
                >
                  {copied ? (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                      </svg>
                      Copy JSON
                    </>
                  )}
                </button>
              </div>

              <pre className="mt-4 max-h-64 overflow-auto rounded-xl border border-white/5 bg-black/30 p-4 font-mono text-xs text-zinc-400">
                {safeTxJson || '// Select an action to generate transaction JSON'}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
