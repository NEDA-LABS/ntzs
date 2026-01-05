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

export function NtzsAdminPanel({
  contractAddress,
  chainLabel,
  safeAdmin,
}: {
  contractAddress: string
  chainLabel: string
  safeAdmin: string
}) {
  const [action, setAction] = useState<Action>('pause')
  const [account, setAccount] = useState('')

  const basescanContractUrl = useMemo(() => {
    if (!ethers.isAddress(contractAddress)) return ''
    return `https://sepolia.basescan.org/address/${contractAddress}`
  }, [contractAddress])

  const tokenListUrl = '/tokenlist.json'
  const tokenLogoUrl = '/ntzs-logo.png'

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

  const { to, data, error } = useMemo(() => {
    const to = contractAddress

    try {
      if (!ethers.isAddress(to)) {
        return { to, data: '', error: 'Invalid contract address' }
      }

      const needsAccount =
        action === 'freeze' ||
        action === 'unfreeze' ||
        action === 'blacklist' ||
        action === 'unblacklist' ||
        action === 'wipeBlacklisted'

      if (needsAccount) {
        if (!ethers.isAddress(account)) {
          return { to, data: '', error: 'Enter a valid wallet address' }
        }

        return {
          to,
          data: iface.encodeFunctionData(action, [account]),
          error: '',
        }
      }

      return {
        to,
        data: iface.encodeFunctionData(action, []),
        error: '',
      }
    } catch (e) {
      return {
        to,
        data: '',
        error: e instanceof Error ? e.message : 'Failed to encode calldata',
      }
    }
  }, [account, action, contractAddress, iface])

  const safeTxJson = useMemo(() => {
    if (!to || !data) return ''

    return JSON.stringify(
      {
        version: '1.0',
        chainId: chainLabel,
        createdAt: new Date().toISOString(),
        meta: {
          name: 'nTZS Admin Action',
          description: action,
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
  }, [action, chainLabel, data, to])

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-violet-500/10 p-2">
            <svg className="h-5 w-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-white">nTZS Token Admin</h2>
            <p className="text-xs text-zinc-500">On-chain admin actions via Safe</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Contract Info Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Chain</p>
            <p className="mt-1 font-mono text-sm text-white">{chainLabel}</p>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Contract</p>
            <p className="mt-1 truncate font-mono text-sm text-white" title={contractAddress}>{contractAddress}</p>
            {basescanContractUrl && (
              <a
                href={basescanContractUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center text-xs text-blue-400 hover:text-blue-300"
              >
                View on BaseScan →
              </a>
            )}
          </div>
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Safe Admin</p>
            <p className="mt-1 truncate font-mono text-sm text-white" title={safeAdmin}>{safeAdmin}</p>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Resources</p>
            <div className="mt-1 flex gap-3">
              <a href={tokenListUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300">
                Token List
              </a>
              <a href={tokenLogoUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300">
                Logo
              </a>
            </div>
          </div>
        </div>

        {/* Action Builder */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Left: Action Selection */}
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-zinc-300">Select Action</label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as Action)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-white focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/10"
              >
                <option value="pause">⏸ Pause Contract</option>
                <option value="unpause">▶ Unpause Contract</option>
                <option value="freeze">❄️ Freeze Account</option>
                <option value="unfreeze">🔓 Unfreeze Account</option>
                <option value="blacklist">⛔ Blacklist Account</option>
                <option value="unblacklist">✅ Remove from Blacklist</option>
                <option value="wipeBlacklisted">🗑 Wipe Blacklisted Balance</option>
              </select>
            </div>

            {(action === 'freeze' ||
              action === 'unfreeze' ||
              action === 'blacklist' ||
              action === 'unblacklist' ||
              action === 'wipeBlacklisted') && (
              <div>
                <label className="text-sm font-medium text-zinc-300">Target Address</label>
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="0x..."
                  className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-900 px-4 py-3 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/10"
                />
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-4">
                <p className="text-sm text-rose-400">{error}</p>
              </div>
            )}
          </div>

          {/* Right: Transaction Payload */}
          <div className="space-y-4">
            <p className="text-sm font-medium text-zinc-300">Transaction Payload</p>
            
            <div className="space-y-3">
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">to</p>
                <p className="mt-1 break-all font-mono text-xs text-zinc-300">{to}</p>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">value</p>
                <p className="mt-1 font-mono text-xs text-zinc-300">0</p>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">data</p>
                <p className="mt-1 break-all font-mono text-xs text-zinc-300">{data || '—'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Safe TX JSON */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-300">Safe Transaction Builder JSON</p>
            <button
              onClick={() => navigator.clipboard.writeText(safeTxJson)}
              className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/10 transition-colors"
            >
              Copy JSON
            </button>
          </div>
          <textarea
            value={safeTxJson}
            readOnly
            className="mt-2 h-32 w-full rounded-lg border border-white/10 bg-zinc-900 p-4 font-mono text-xs text-zinc-400 focus:outline-none"
          />
        </div>
      </div>
    </div>
  )
}
