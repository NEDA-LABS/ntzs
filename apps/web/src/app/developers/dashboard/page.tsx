'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatDateEAT } from '@/lib/format-date'

interface PartnerInfo {
  id: string
  name: string
  apiKeyPrefix: string
  webhookUrl: string | null
  nextWalletIndex: number
  treasuryWalletAddress: string | null
  feePercent: number
  treasuryBalanceTzs: number
  createdAt: string
}

interface DashboardUser {
  id: string
  externalId: string
  email: string
  phone: string | null
  walletAddress: string | null
  balanceTzs: number
  createdAt: string
}

interface DashboardTransfer {
  id: string
  fromUserId: string
  toUserId: string
  amountTzs: number
  status: string
  txHash: string | null
  createdAt: string
}

interface DashboardDeposit {
  id: string
  userId: string
  amountTzs: number
  status: string
  pspReference: string | null
  createdAt: string
}

interface DashboardData {
  partner: PartnerInfo
  users: DashboardUser[]
  transfers: DashboardTransfer[]
  deposits: DashboardDeposit[]
  stats: {
    totalUsers: number
    totalBalanceTzs: number
    totalTransfers: number
    totalDeposits: number
  }
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <div className="text-xs font-medium text-white/40">{label}</div>
      <div className="mt-2 text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-white/40">{sub}</div>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    minted: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    pending: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    submitted: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    failed: 'border-red-500/30 bg-red-500/10 text-red-300',
  }
  const cls = colors[status] || 'border-white/10 bg-white/5 text-white/60'
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {status}
    </span>
  )
}

function SettingsTab({ partner, onKeyRegenerated }: { partner: PartnerInfo; onKeyRegenerated: () => void }) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  // Webhook state
  const [editingWebhook, setEditingWebhook] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState(partner.webhookUrl || '')
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [webhookError, setWebhookError] = useState('')
  const [webhookSuccess, setWebhookSuccess] = useState(false)

  // Fee config state
  const [feeInput, setFeeInput] = useState(String(partner.feePercent))
  const [feeSaving, setFeeSaving] = useState(false)
  const [feeError, setFeeError] = useState('')
  const [feeSuccess, setFeeSuccess] = useState(false)

  // Withdraw earnings state
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const [withdrawSuccess, setWithdrawSuccess] = useState('')

  const handleRegenerate = async () => {
    setRegenerating(true)
    setError('')
    try {
      const res = await fetch('/api/v1/partners/regenerate-key', {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed to regenerate key')
        return
      }
      setNewApiKey(json.apiKey)
      setShowConfirm(false)
      onKeyRegenerated()
    } catch {
      setError('Failed to connect to server')
    } finally {
      setRegenerating(false)
    }
  }

  const copyToClipboard = () => {
    if (newApiKey) {
      navigator.clipboard.writeText(newApiKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleSaveWebhook = async () => {
    setWebhookSaving(true)
    setWebhookError('')
    setWebhookSuccess(false)
    try {
      const res = await fetch('/api/v1/partners/webhook', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ webhookUrl: webhookUrl.trim() || null }),
      })
      const json = await res.json()
      if (!res.ok) {
        setWebhookError(json.error || 'Failed to update webhook')
        return
      }
      setWebhookSuccess(true)
      setEditingWebhook(false)
      onKeyRegenerated() // Refresh dashboard data
      setTimeout(() => setWebhookSuccess(false), 3000)
    } catch {
      setWebhookError('Failed to connect to server')
    } finally {
      setWebhookSaving(false)
    }
  }

  const handleSaveFee = async () => {
    const val = parseFloat(feeInput)
    if (isNaN(val) || val < 0 || val > 100) {
      setFeeError('Fee must be between 0 and 100')
      return
    }
    setFeeSaving(true)
    setFeeError('')
    setFeeSuccess(false)
    try {
      const res = await fetch('/api/v1/partners/fee', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ feePercent: val }),
      })
      const json = await res.json()
      if (!res.ok) {
        setFeeError(json.error || 'Failed to update fee')
        return
      }
      setFeeSuccess(true)
      onKeyRegenerated()
      setTimeout(() => setFeeSuccess(false), 3000)
    } catch {
      setFeeError('Failed to connect to server')
    } finally {
      setFeeSaving(false)
    }
  }

  const handleWithdrawEarnings = async () => {
    setWithdrawing(true)
    setWithdrawError('')
    setWithdrawSuccess('')
    try {
      const res = await fetch('/api/v1/partners/withdraw', {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json()
      if (!res.ok) {
        setWithdrawError(json.error || 'Withdrawal failed')
        return
      }
      setWithdrawSuccess(`Withdrawal initiated! Reference: ${json.reference || json.txHash || 'processing'}`)
      onKeyRegenerated()
    } catch {
      setWithdrawError('Failed to connect to server')
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-base font-semibold">API Key</h3>
        
        {newApiKey ? (
          <div className="mt-4">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p className="text-xs text-emerald-300 font-medium mb-2">
                New API key generated! Copy it now — it will not be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-black/30 px-3 py-2 text-sm font-mono text-white/90 break-all">
                  {newApiKey}
                </code>
                <button
                  onClick={copyToClipboard}
                  className="shrink-0 rounded-lg bg-emerald-500/20 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-white/50">
              Your key starts with <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">{partner.apiKeyPrefix}...</code>
            </p>
            
            {showConfirm ? (
              <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                <p className="text-sm text-red-200 font-medium">Are you sure?</p>
                <p className="mt-1 text-xs text-red-300/70">
                  Your current API key will be revoked immediately. Any integrations using the old key will stop working.
                </p>
                {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    className="rounded-lg bg-red-500/20 px-4 py-2 text-xs font-medium text-red-300 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                  >
                    {regenerating ? 'Regenerating...' : 'Yes, regenerate key'}
                  </button>
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="rounded-lg bg-white/10 px-4 py-2 text-xs font-medium text-white/70 hover:bg-white/20 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowConfirm(true)}
                className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10 transition-colors"
              >
                Regenerate API Key
              </button>
            )}
          </>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-base font-semibold">Webhook Configuration</h3>
        <p className="mt-1 text-sm text-white/50">
          Receive real-time notifications when events occur (deposits, transfers, etc.)
        </p>

        {webhookSuccess && (
          <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
            Webhook URL updated successfully!
          </div>
        )}

        {editingWebhook ? (
          <div className="mt-4">
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://your-app.com/webhooks/ntzs"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
            />
            {webhookError && <p className="mt-2 text-xs text-red-400">{webhookError}</p>}
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleSaveWebhook}
                disabled={webhookSaving}
                className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90 transition-colors disabled:opacity-50"
              >
                {webhookSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setEditingWebhook(false)
                  setWebhookUrl(partner.webhookUrl || '')
                  setWebhookError('')
                }}
                className="rounded-lg bg-white/10 px-4 py-2 text-xs font-medium text-white/70 hover:bg-white/20 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            {partner.webhookUrl ? (
              <div className="flex items-center gap-3">
                <code className="flex-1 rounded bg-white/10 px-2 py-1.5 text-xs text-white/70 truncate">
                  {partner.webhookUrl}
                </code>
                <button
                  onClick={() => setEditingWebhook(true)}
                  className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 transition-colors"
                >
                  Edit
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingWebhook(true)}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10 transition-colors"
              >
                Configure Webhook
              </button>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-base font-semibold">Platform Fee</h3>
        <p className="mt-1 text-sm text-white/50">
          Set a percentage fee automatically collected into your treasury on every transfer.
        </p>
        <div className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-white/40">Fee percentage (0–100)</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={feeInput}
                onChange={(e) => setFeeInput(e.target.value)}
                className="w-28 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
              <span className="text-sm text-white/40">%</span>
            </div>
          </div>
          <button
            onClick={handleSaveFee}
            disabled={feeSaving}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90 transition-colors disabled:opacity-50"
          >
            {feeSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {feeError && <p className="mt-2 text-xs text-red-400">{feeError}</p>}
        {feeSuccess && <p className="mt-2 text-xs text-emerald-400">Fee updated successfully!</p>}
        <p className="mt-3 text-xs text-white/30">
          Current: <span className="text-white/60">{partner.feePercent}%</span> — users pay the gross amount, recipient receives the net, your treasury receives the fee automatically.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold">Treasury Wallet</h3>
            <p className="mt-1 text-sm text-white/50">
              Your earnings wallet. Withdraw to mobile money at any time.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-white/40">Balance</div>
            <div className="text-xl font-bold text-emerald-400">{partner.treasuryBalanceTzs.toLocaleString()} TZS</div>
          </div>
        </div>
        {partner.treasuryWalletAddress && (
          <div className="mt-3">
            <div className="text-xs text-white/40 mb-1">Wallet address</div>
            <code className="rounded bg-white/10 px-2 py-1.5 text-xs text-white/60 break-all">
              {partner.treasuryWalletAddress}
            </code>
          </div>
        )}
        {partner.treasuryBalanceTzs > 0 ? (
          <button
            onClick={handleWithdrawEarnings}
            disabled={withdrawing}
            className="mt-4 rounded-lg bg-emerald-500/20 px-5 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
          >
            {withdrawing ? 'Initiating withdrawal...' : `Withdraw ${partner.treasuryBalanceTzs.toLocaleString()} TZS`}
          </button>
        ) : (
          <p className="mt-3 text-xs text-white/30">No earnings yet. Set a fee percentage above to start collecting.</p>
        )}
        {withdrawError && <p className="mt-2 text-xs text-red-400">{withdrawError}</p>}
        {withdrawSuccess && <p className="mt-2 text-xs text-emerald-400">{withdrawSuccess}</p>}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-base font-semibold">Wallet Info</h3>
        <p className="mt-1 text-sm text-white/50">
          HD wallet seed: Active &middot; {partner.nextWalletIndex} wallets derived
        </p>
      </div>
    </div>
  )
}

export default function PartnerDashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'users' | 'deposits' | 'transfers' | 'settings'>('users')

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/partners/dashboard', { credentials: 'include' })
      if (res.status === 401) {
        router.push('/developers/login')
        return
      }
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed to load dashboard')
        return
      }
      setData(json)
    } catch {
      setError('Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-6 py-20">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
          <p className="text-sm text-red-300">{error}</p>
          <button
            onClick={() => router.push('/developers/login')}
            className="mt-4 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-white/90"
          >
            Log in
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { partner, users, transfers, deposits, stats } = data

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{partner.name}</h1>
          <p className="mt-1 text-sm text-white/50">
            Partner ID: <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">{partner.id}</code>
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-white/40">API Key</div>
          <code className="text-sm text-white/70">{partner.apiKeyPrefix}...●●●●</code>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
        <StatCard label="Total Users" value={String(stats.totalUsers)} />
        <StatCard
          label="User Holdings"
          value={`${stats.totalBalanceTzs.toLocaleString()} TZS`}
          sub="Funds held by your users"
        />
        <StatCard
          label="Your Earnings"
          value={`${partner.treasuryBalanceTzs.toLocaleString()} TZS`}
          sub={partner.feePercent > 0 ? `${partner.feePercent}% platform fee` : 'No fee configured'}
        />
        <StatCard label="Transfers" value={String(stats.totalTransfers)} />
        <StatCard label="Deposits" value={String(stats.totalDeposits)} />
      </div>

      {/* Tabs */}
      <div className="mt-8 flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {(['users', 'deposits', 'transfers', 'settings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm capitalize transition-colors ${
              tab === t ? 'bg-white text-black font-semibold' : 'text-white/60 hover:text-white/80'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {tab === 'users' && (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-3 text-left text-xs font-medium text-white/40">External ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Wallet</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-white/40">Balance</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-white/40">
                      No users yet. Create your first user via the SDK.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-xs text-white/70">{u.externalId}</td>
                      <td className="px-4 py-3 text-white/70">{u.email}</td>
                      <td className="px-4 py-3 font-mono text-xs text-white/50">
                        {u.walletAddress
                          ? `${u.walletAddress.slice(0, 6)}...${u.walletAddress.slice(-4)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-white/80">
                        {u.balanceTzs.toLocaleString()} TZS
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'deposits' && (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-3 text-left text-xs font-medium text-white/40">ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-white/40">User</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-white/40">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Date</th>
                </tr>
              </thead>
              <tbody>
                {deposits.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-white/40">
                      No deposits yet.
                    </td>
                  </tr>
                ) : (
                  deposits.map((d) => (
                    <tr key={d.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-xs text-white/50">{d.id.slice(0, 8)}...</td>
                      <td className="px-4 py-3 font-mono text-xs text-white/70">{d.userId.slice(0, 8)}...</td>
                      <td className="px-4 py-3 text-right font-mono text-white/80">
                        {d.amountTzs.toLocaleString()} TZS
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                      <td className="px-4 py-3 text-xs text-white/40">
                        {formatDateEAT(d.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'transfers' && (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-3 text-left text-xs font-medium text-white/40">From</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-white/40">To</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-white/40">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {transfers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-white/40">
                      No transfers yet.
                    </td>
                  </tr>
                ) : (
                  transfers.map((t) => (
                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-xs text-white/70">{t.fromUserId.slice(0, 8)}...</td>
                      <td className="px-4 py-3 font-mono text-xs text-white/70">{t.toUserId.slice(0, 8)}...</td>
                      <td className="px-4 py-3 text-right font-mono text-white/80">
                        {t.amountTzs.toLocaleString()} TZS
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                      <td className="px-4 py-3 font-mono text-xs text-white/40">
                        {t.txHash ? `${t.txHash.slice(0, 10)}...` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'settings' && (
          <SettingsTab partner={partner} onKeyRegenerated={fetchDashboard} />
        )}
      </div>
    </div>
  )
}
