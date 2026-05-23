'use client'

import { useEffect, useState } from 'react'

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Transfer {
  id: string
  amountTzs: number
  status: string
  txHash: string | null
  label: string
  direction: 'in'
  createdAt: string
}

interface WithdrawRequest {
  id: string
  amountTzs: number
  payoutMethod: string
  payoutPhone: string | null
  status: string
  createdAt: string
}

interface WalletData {
  walletAddress: string | null
  balanceTzs: number
  accountName: string
  recentTransfers: Transfer[]
  pendingWithdrawals: WithdrawRequest[]
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed:  'text-emerald-700 bg-emerald-50 border-emerald-200',
    pending:    'text-amber-700 bg-amber-50 border-amber-200',
    processing: 'text-blue-700 bg-blue-50 border-blue-200',
    failed:     'text-red-700 bg-red-50 border-red-200',
  }
  return (
    <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border rounded ${map[status] ?? map.pending}`}>
      {status}
    </span>
  )
}

export default function WalletPage() {
  const [data, setData] = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit')
  const [copied, setCopied] = useState(false)

  // Withdraw form
  const [amount, setAmount] = useState('')
  const [payoutMethod, setPayoutMethod] = useState<'mobile' | 'bank'>('mobile')
  const [phone, setPhone] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const [withdrawSuccess, setWithdrawSuccess] = useState('')

  useEffect(() => {
    fetch('/enterprise/api/wallet')
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  function copyAddress() {
    if (!data?.walletAddress) return
    navigator.clipboard.writeText(data.walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleWithdraw(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setWithdrawError(''); setWithdrawSuccess(''); setWithdrawing(true)
    try {
      const res = await fetch('/enterprise/api/wallet/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountTzs: Number(amount),
          payoutMethod,
          payoutPhone: payoutMethod === 'mobile' ? phone : undefined,
          payoutBankAccount: payoutMethod === 'bank' ? bankAccount : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setWithdrawError(json.error ?? 'Failed'); return }
      setWithdrawSuccess('Withdrawal request submitted. NEDApay will process it within 1 business day.')
      setAmount(''); setPhone(''); setBankAccount('')
      const updated = await fetch('/enterprise/api/wallet').then(r => r.json())
      setData(updated)
    } catch { setWithdrawError('Network error') }
    finally { setWithdrawing(false) }
  }

  if (loading) {
    return (
      <div className="p-10">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-24 bg-gray-200 rounded" />
          <div className="h-32 bg-gray-200 rounded-lg" />
          <div className="h-48 bg-gray-200 rounded-lg" />
        </div>
      </div>
    )
  }

  const allActivity = [
    ...(data?.recentTransfers ?? []).map(t => ({ ...t, kind: 'in' as const })),
    ...(data?.pendingWithdrawals ?? []).map(w => ({
      id: w.id,
      amountTzs: w.amountTzs,
      status: w.status,
      txHash: null,
      label: `withdrawal · ${w.payoutMethod}`,
      kind: 'out' as const,
      createdAt: w.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <div className="p-10 space-y-8 max-w-3xl">
      {/* Header */}
      <div>
        <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-1">Enterprise</p>
        <h1 className="text-2xl font-light text-gray-900">Wallet</h1>
      </div>

      {/* Wallet address bar */}
      {data?.walletAddress ? (
        <div className="flex items-center gap-3 border border-gray-200 bg-gray-50 rounded-lg px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-0.5">Treasury Wallet Address</p>
            <p className="text-xs text-gray-700 font-mono truncate">{data.walletAddress}</p>
          </div>
          <button
            onClick={copyAddress}
            className="shrink-0 text-[10px] tracking-widest uppercase px-3 py-1.5 border border-gray-300 text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors rounded"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      ) : (
        <div className="border border-amber-200 bg-amber-50 rounded-lg px-4 py-3">
          <p className="text-xs text-amber-700">Wallet not yet activated. Contact NEDApay to link your partner account.</p>
        </div>
      )}

      {/* Balance card */}
      <div className="border border-indigo-100 bg-indigo-50 rounded-xl p-6">
        <p className="text-[10px] tracking-widest text-indigo-400 uppercase mb-2">nTZS Balance</p>
        <p className="text-4xl font-light text-indigo-700 tabular-nums">
          {fmt(data?.balanceTzs ?? 0)}
          <span className="text-lg text-indigo-400 ml-2">nTZS</span>
        </p>
        <p className="text-[10px] text-indigo-400 mt-1">≈ TZS {fmt(data?.balanceTzs ?? 0)} · 1:1 peg</p>
      </div>

      {/* Deposit / Withdraw tabs */}
      {data?.walletAddress && (
        <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex border-b border-gray-100">
            {(['deposit', 'withdraw'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-3 text-xs tracking-widest uppercase transition-colors ${
                  tab === t
                    ? 'border-b-2 border-indigo-600 text-indigo-600 font-medium'
                    : 'text-gray-400 hover:text-gray-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="p-6">
            {tab === 'deposit' && (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-medium text-gray-800 mb-1">Bank Transfer (TZS → nTZS)</p>
                  <p className="text-xs text-gray-400">Transfer TZS to NEDApay's account below. nTZS is minted 1:1 to your treasury wallet within 1 business day.</p>
                </div>

                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {[
                    { label: 'Bank', value: 'CRDB Bank Tanzania' },
                    { label: 'Account Name', value: 'NEDApay Limited' },
                    { label: 'Account Number', value: '0150735894900' },
                    { label: 'Reference', value: data.accountName },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between px-4 py-3">
                      <span className="text-[10px] tracking-widest text-gray-400 uppercase">{row.label}</span>
                      <span className="text-sm text-gray-800 font-medium">{row.value}</span>
                    </div>
                  ))}
                </div>

                <div className="border border-gray-100 rounded-lg p-4 bg-gray-50">
                  <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-2">Or: On-chain Transfer</p>
                  <p className="text-xs text-gray-500">Send nTZS directly to your treasury wallet address above from any compatible wallet (Base network).</p>
                </div>
              </div>
            )}

            {tab === 'withdraw' && (
              <form onSubmit={handleWithdraw} className="space-y-5">
                <div>
                  <p className="text-sm font-medium text-gray-800 mb-1">Withdraw nTZS → TZS</p>
                  <p className="text-xs text-gray-400">NEDApay burns your nTZS and sends TZS to your nominated account within 1 business day.</p>
                </div>

                {/* Payout method */}
                <div>
                  <label className="block text-xs text-gray-500 mb-2">Payout method</label>
                  <div className="flex gap-3">
                    {(['mobile', 'bank'] as const).map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPayoutMethod(m)}
                        className={`px-4 py-2 text-xs rounded border transition-colors ${
                          payoutMethod === m
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                            : 'border-gray-200 text-gray-500 hover:border-gray-400'
                        }`}
                      >
                        {m === 'mobile' ? 'Mobile Money' : 'Bank Transfer'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-xs text-gray-500 mb-2">Amount (nTZS)</label>
                  <input
                    type="number"
                    min={1000}
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    required
                    placeholder="e.g. 500000"
                    className="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm px-3 py-2 rounded focus:outline-none focus:border-indigo-500"
                  />
                  {Number(amount) > 0 && (
                    <p className="text-[10px] text-gray-400 mt-1">You receive ≈ TZS {fmt(Number(amount))}</p>
                  )}
                </div>

                {/* Phone or bank */}
                {payoutMethod === 'mobile' ? (
                  <div>
                    <label className="block text-xs text-gray-500 mb-2">Mobile number</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      required
                      placeholder="+255 7XX XXX XXX"
                      className="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm px-3 py-2 rounded focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-gray-500 mb-2">Bank account number</label>
                    <input
                      type="text"
                      value={bankAccount}
                      onChange={e => setBankAccount(e.target.value)}
                      required
                      placeholder="Account number"
                      className="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm px-3 py-2 rounded focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                )}

                {withdrawError && <p className="text-xs text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{withdrawError}</p>}
                {withdrawSuccess && <p className="text-xs text-emerald-700 border border-emerald-200 bg-emerald-50 px-3 py-2 rounded">{withdrawSuccess}</p>}

                <button
                  type="submit"
                  disabled={withdrawing || !amount}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs py-2.5 uppercase tracking-widest transition-colors rounded"
                >
                  {withdrawing ? 'Submitting…' : 'Request Withdrawal'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Transaction history */}
      <div>
        <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-4">Transaction History</p>
        {allActivity.length === 0 ? (
          <div className="border border-gray-100 rounded-lg p-8 text-center">
            <p className="text-xs text-gray-400">No transactions yet.</p>
          </div>
        ) : (
          <div className="border border-gray-200 bg-white rounded-lg shadow-sm overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  {['Date', 'Type', 'Amount', 'Status', 'Tx'].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-[10px] tracking-widest text-gray-400 uppercase font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allActivity.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-gray-500">{fmtDate(row.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-bold ${row.kind === 'in' ? 'text-emerald-500' : 'text-indigo-400'}`}>
                          {row.kind === 'in' ? '↓' : '↑'}
                        </span>
                        <span className="text-gray-600 capitalize">{row.label.replace('_', ' ')}</span>
                      </div>
                    </td>
                    <td className={`px-5 py-3 font-semibold tabular-nums ${row.kind === 'in' ? 'text-emerald-600' : 'text-gray-700'}`}>
                      {row.kind === 'in' ? '+' : '-'}TZS {fmt(row.amountTzs)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-5 py-3">
                      {row.txHash ? (
                        <a
                          href={`https://basescan.org/tx/${row.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-indigo-600 hover:text-indigo-700 font-mono"
                        >
                          {row.txHash.slice(0, 8)}…{row.txHash.slice(-4)}
                        </a>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
