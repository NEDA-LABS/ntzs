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
    <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-black">
      <h2 className="text-lg font-semibold">nTZS Admin</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        This panel generates Safe-ready calldata for on-chain admin actions. Execute the
        transaction from your Safe.
      </p>

      <div className="mt-4 grid gap-3 text-sm">
        <div>
          <div className="font-medium">Chain</div>
          <div className="text-zinc-600 dark:text-zinc-400">{chainLabel}</div>
        </div>

        <div>
          <div className="font-medium">Contract</div>
          <div className="break-all text-zinc-600 dark:text-zinc-400">
            {contractAddress}
          </div>
          <div className="mt-1 text-xs">
            {basescanContractUrl ? (
              <a
                href={basescanContractUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                View on BaseScan
              </a>
            ) : null}
          </div>
        </div>

        <div>
          <div className="font-medium">Safe admin</div>
          <div className="break-all text-zinc-600 dark:text-zinc-400">{safeAdmin}</div>
        </div>

        <div>
          <div className="font-medium">Metadata</div>
          <div className="text-zinc-600 dark:text-zinc-400">
            <a href={tokenListUrl} target="_blank" rel="noreferrer" className="underline">
              Token list
            </a>
            {' · '}
            <a href={tokenLogoUrl} target="_blank" rel="noreferrer" className="underline">
              Logo
            </a>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4">
        <div className="grid gap-2">
          <label className="text-sm font-medium">Action</label>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as Action)}
            className="rounded border bg-transparent px-2 py-2"
          >
            <option value="pause">pause</option>
            <option value="unpause">unpause</option>
            <option value="freeze">freeze</option>
            <option value="unfreeze">unfreeze</option>
            <option value="blacklist">blacklist</option>
            <option value="unblacklist">unblacklist</option>
            <option value="wipeBlacklisted">wipeBlacklisted</option>
          </select>
        </div>

        {(action === 'freeze' ||
          action === 'unfreeze' ||
          action === 'blacklist' ||
          action === 'unblacklist' ||
          action === 'wipeBlacklisted') && (
          <div className="grid gap-2">
            <label className="text-sm font-medium">Target address</label>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="0x..."
              className="rounded border bg-transparent px-2 py-2"
            />
          </div>
        )}

        <div className="grid gap-2">
          <label className="text-sm font-medium">Transaction payload</label>

          {error ? (
            <div className="rounded border border-red-400 bg-red-50 p-3 text-red-700 dark:bg-transparent">
              {error}
            </div>
          ) : null}

          <div className="grid gap-2">
            <div>
              <div className="text-xs font-medium text-zinc-500">to</div>
              <div className="break-all rounded border px-3 py-2">{to}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-zinc-500">value</div>
              <div className="rounded border px-3 py-2">0</div>
            </div>
            <div>
              <div className="text-xs font-medium text-zinc-500">data</div>
              <div className="break-all rounded border px-3 py-2">{data}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-zinc-500">Safe Tx Builder JSON (optional)</div>
              <textarea
                value={safeTxJson}
                readOnly
                className="h-40 w-full rounded border bg-transparent p-2 font-mono text-xs"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
