'use client'

import { useMemo, useState } from 'react'
import { ethers } from 'ethers'

type Action =
  | 'pause'
  | 'unpause'
  | 'freeze'
  | 'unfreeze'
  | 'blacklist'
  | 'unblacklist'
  | 'wipeBlacklisted'

const actions: { value: Action; label: string; icon: string; description: string; needsAddress: boolean }[] = [
  { value: 'pause', label: 'Pause Contract', icon: '⏸', description: 'Halt all token transfers', needsAddress: false },
  { value: 'unpause', label: 'Unpause Contract', icon: '▶️', description: 'Resume token transfers', needsAddress: false },
  { value: 'freeze', label: 'Freeze Account', icon: '❄️', description: 'Prevent account from sending', needsAddress: true },
  { value: 'unfreeze', label: 'Unfreeze Account', icon: '🔓', description: 'Allow account to send again', needsAddress: true },
  { value: 'blacklist', label: 'Blacklist Account', icon: '⛔', description: 'Block all transfers', needsAddress: true },
  { value: 'unblacklist', label: 'Remove Blacklist', icon: '✅', description: 'Remove from blacklist', needsAddress: true },
  { value: 'wipeBlacklisted', label: 'Wipe Balance', icon: '🗑️', description: 'Burn blacklisted balance', needsAddress: true },
]

export default function TokenAdminPage() {
  const contractAddress = process.env.NEXT_PUBLIC_NTZS_CONTRACT_ADDRESS || ''
  const safeAdmin = process.env.NEXT_PUBLIC_NTZS_SAFE_ADMIN || ''
  const chainLabel = '84532'

  const [selectedAction, setSelectedAction] = useState<Action>('pause')
  const [account, setAccount] = useState('')
  const [copied, setCopied] = useState(false)

  const basescanContractUrl = useMemo(() => {
    if (!contractAddress || !ethers.isAddress(contractAddress)) return ''
    return `https://sepolia.basescan.org/address/${contractAddress}`
  }, [contractAddress])

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
        chainId: chainLabel,
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
  }, [selectedAction, chainLabel, data, to])

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
        {/* Contract Info Bar */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
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
                {basescanContractUrl && (
                  <a href={basescanContractUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300">
                    View on BaseScan →
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
                <p className="font-mono text-sm text-white">Base Sepolia ({chainLabel})</p>
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
                      <span className="text-xl">{action.icon}</span>
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
