'use client'

import { useMemo, useState, useTransition } from 'react'
import { ethers } from 'ethers'

type Props = {
  depositId: string
  amountTzs: number
  walletAddress: string
  contractAddress: string
  chainId: string
  onConfirm: (formData: FormData) => Promise<{ success: boolean; error?: string }>
}

export function SafeMintActions({
  depositId,
  amountTzs,
  walletAddress,
  contractAddress,
  chainId,
  onConfirm,
}: Props) {
  const [txHash, setTxHash] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const amountWei = useMemo(() => {
    const decimals = BigInt(18)
    const base = BigInt(10)
    return (BigInt(String(amountTzs)) * base ** decimals).toString()
  }, [amountTzs])

  const safeTxJson = useMemo(() => {
    if (!contractAddress || !ethers.isAddress(contractAddress)) return ''
    if (!walletAddress || !ethers.isAddress(walletAddress)) return ''

    const iface = new ethers.Interface(['function mint(address to, uint256 amount)'])
    const data = iface.encodeFunctionData('mint', [walletAddress, amountWei])

    return JSON.stringify(
      {
        version: '1.0',
        chainId,
        createdAt: new Date().toISOString(),
        meta: {
          name: 'nTZS Safe Mint',
          description: `Mint ${amountTzs} nTZS to ${walletAddress}`,
        },
        transactions: [
          {
            to: contractAddress,
            value: '0',
            data,
          },
        ],
      },
      null,
      2
    )
  }, [amountTzs, amountWei, chainId, contractAddress, walletAddress])

  const handleCopy = async () => {
    if (!safeTxJson) return
    await navigator.clipboard.writeText(safeTxJson)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDownload = () => {
    if (!safeTxJson) return
    const blob = new Blob([safeTxJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ntzs-safe-mint-${depositId}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleDownload}
          disabled={!safeTxJson}
          className="rounded-lg bg-violet-500/10 px-3 py-2 text-xs font-medium text-violet-300 hover:bg-violet-500/20 transition-colors disabled:opacity-50"
        >
          Download Safe JSON
        </button>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!safeTxJson}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-50"
        >
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          
          // Client-side validation
          if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
            setError('Invalid transaction hash. Must be 0x followed by 64 hex characters.')
            return
          }
          
          const formData = new FormData()
          formData.set('depositId', depositId)
          formData.set('txHash', txHash)
          
          startTransition(async () => {
            try {
              const result = await onConfirm(formData)
              if (!result.success) {
                setError(result.error || 'Failed to confirm mint')
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : 'An unexpected error occurred')
            }
          })
        }}
        className="flex items-center gap-2"
      >
        <input
          name="txHash"
          value={txHash}
          onChange={(e) => {
            setTxHash(e.target.value)
            setError(null)
          }}
          placeholder="Paste tx hash (0x...)"
          className="w-64 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 font-mono text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
        />
        <button
          type="submit"
          disabled={isPending || !txHash}
          className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
        >
          {isPending ? 'Confirming...' : 'Confirm Mint'}
        </button>
      </form>

      {error && (
        <div className="text-[11px] text-red-400 bg-red-500/10 rounded px-2 py-1">
          {error}
        </div>
      )}

      <div className="text-[11px] text-zinc-500">
        Over threshold: requires Safe execution. After execution, paste the tx hash and confirm.
      </div>
    </div>
  )
}
