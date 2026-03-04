'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatDateEAT } from '@/lib/format-date'

interface PartnerInfo {
  id: string
  name: string
  email: string | null
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
  name: string | null
  phone: string | null
  walletAddress: string | null
  balanceTzs: number
  createdAt: string
}

interface DashboardTransfer {
  id: string
  fromUserId: string
  toUserId: string
  fromEmail: string | null
  fromName: string | null
  toEmail: string | null
  toName: string | null
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
    totalWallets: number
    totalBalanceTzs: number
    totalTransfers: number
    totalDeposits: number
  }
}

type Section = 'overview' | 'wallets' | 'transfers' | 'deposits' | 'treasury' | 'settings'

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

/* ── Sidebar Nav Item ── */
function NavItem({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
        active ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/70'
      }`}
    >
      <span className="text-base">{icon}</span>
      {label}
    </button>
  )
}

/* ── Send TZS Modal ── */
function SendModal({ users, onClose, onSuccess }: { users: DashboardUser[]; onClose: () => void; onSuccess: () => void }) {
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSend = async () => {
    if (!fromId || !toId || !amount) {
      setError('All fields are required')
      return
    }
    if (fromId === toId) {
      setError('Sender and recipient must be different')
      return
    }
    const fromUser = users.find((u) => u.id === fromId)
    const toUser = users.find((u) => u.id === toId)
    if (!fromUser || !toUser) {
      setError('Invalid sender or recipient')
      return
    }
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/v1/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          fromExternalId: fromUser.externalId,
          toExternalId: toUser.externalId,
          amountTzs: Number(amount),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Transfer failed')
        return
      }
      setSuccess(true)
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 1500)
    } catch {
      setError('Failed to connect to server')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0f] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Send TZS</h3>
        <p className="mt-1 text-sm text-white/50">Transfer funds between wallets</p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-white/40">From</label>
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              <option value="">Select sender</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email} ({u.balanceTzs.toLocaleString()} TZS)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-white/40">To</label>
            <select
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              <option value="">Select recipient</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-white/40">Amount (TZS)</label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        {success && <p className="mt-3 text-xs text-emerald-400">Transfer sent successfully!</p>}

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleSend}
            disabled={sending || success}
            className="flex-1 rounded-xl bg-white py-2.5 text-sm font-semibold text-black hover:bg-white/90 transition-colors disabled:opacity-50"
          >
            {sending ? 'Sending...' : success ? 'Sent!' : 'Send TZS'}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm text-white/70 hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Treasury Section ── */
function TreasurySection({ partner, onRefresh }: { partner: PartnerInfo; onRefresh: () => void }) {
  const [feeInput, setFeeInput] = useState(String(partner.feePercent))
  const [feeSaving, setFeeSaving] = useState(false)
  const [feeError, setFeeError] = useState('')
  const [feeSuccess, setFeeSuccess] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const [withdrawSuccess, setWithdrawSuccess] = useState('')
  const [copied, setCopied] = useState(false)

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
      onRefresh()
      setTimeout(() => setFeeSuccess(false), 3000)
    } catch {
      setFeeError('Failed to connect to server')
    } finally {
      setFeeSaving(false)
    }
  }

  const handleWithdraw = async () => {
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
      onRefresh()
    } catch {
      setWithdrawError('Failed to connect to server')
    } finally {
      setWithdrawing(false)
    }
  }

  const copyAddress = () => {
    if (partner.treasuryWalletAddress) {
      navigator.clipboard.writeText(partner.treasuryWalletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="space-y-6">
      {/* Treasury metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <div className="text-xs font-medium text-emerald-400/60">Treasury Balance</div>
          <div className="mt-2 text-3xl font-bold text-emerald-400">{partner.treasuryBalanceTzs.toLocaleString()} TZS</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs font-medium text-white/40">Platform Fee</div>
          <div className="mt-2 text-3xl font-bold">{partner.feePercent}%</div>
          <div className="mt-1 text-xs text-white/40">on every transfer</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs font-medium text-white/40">Wallet Info</div>
          <div className="mt-2 text-lg font-bold">{partner.nextWalletIndex} wallets</div>
          <div className="mt-1 text-xs text-white/40">HD seed active</div>
        </div>
      </div>

      {/* Treasury wallet address */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-base font-semibold">Treasury Wallet</h3>
        <p className="mt-1 text-sm text-white/50">Your earnings wallet. Withdraw to mobile money at any time.</p>
        {partner.treasuryWalletAddress && (
          <div className="mt-4 flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-black/30 px-3 py-2 text-xs text-white/60 break-all">
              {partner.treasuryWalletAddress}
            </code>
            <button
              onClick={copyAddress}
              className="shrink-0 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/70 hover:bg-white/20 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}
        {partner.treasuryBalanceTzs > 0 ? (
          <button
            onClick={handleWithdraw}
            disabled={withdrawing}
            className="mt-4 rounded-xl bg-emerald-500/20 px-6 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
          >
            {withdrawing ? 'Initiating withdrawal...' : `Withdraw ${partner.treasuryBalanceTzs.toLocaleString()} TZS`}
          </button>
        ) : (
          <p className="mt-3 text-xs text-white/30">No earnings yet. Configure a platform fee to start collecting.</p>
        )}
        {withdrawError && <p className="mt-2 text-xs text-red-400">{withdrawError}</p>}
        {withdrawSuccess && <p className="mt-2 text-xs text-emerald-400">{withdrawSuccess}</p>}
      </div>

      {/* Fee configuration */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-base font-semibold">Platform Fee</h3>
        <p className="mt-1 text-sm text-white/50">
          Set a percentage fee automatically collected into your treasury on every transfer.
        </p>
        <div className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-white/40">Fee percentage (0-100)</label>
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
            className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-white/90 transition-colors disabled:opacity-50"
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
    </div>
  )
}

/* ── Settings Section ── */
function SettingsSection({ partner, onRefresh }: { partner: PartnerInfo; onRefresh: () => void }) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [editingWebhook, setEditingWebhook] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState(partner.webhookUrl || '')
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [webhookError, setWebhookError] = useState('')
  const [webhookSuccess, setWebhookSuccess] = useState(false)

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
      onRefresh()
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
      onRefresh()
      setTimeout(() => setWebhookSuccess(false), 3000)
    } catch {
      setWebhookError('Failed to connect to server')
    } finally {
      setWebhookSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* API Key */}
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

      {/* Webhook */}
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
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════════
   Main Dashboard Page
   ══════════════════════════════════════════════════════════════════════════════ */
export default function PartnerDashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [section, setSection] = useState<Section>('overview')
  const [showSendModal, setShowSendModal] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
      <div className="flex min-h-screen items-center justify-center bg-[#060609]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060609]">
        <div className="mx-auto max-w-lg px-6">
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
      </div>
    )
  }

  if (!data) return null

  const { partner, users, transfers, deposits, stats } = data

  const navItems: { key: Section; label: string; icon: string }[] = [
    { key: 'overview', label: 'Overview', icon: '📊' },
    { key: 'wallets', label: 'Wallets', icon: '💳' },
    { key: 'transfers', label: 'Transfers', icon: '🔄' },
    { key: 'deposits', label: 'Deposits', icon: '💰' },
    { key: 'treasury', label: 'Treasury', icon: '🏦' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  const handleLogout = async () => {
    document.cookie = 'partner_session=; path=/; max-age=0'
    router.push('/developers/login')
  }

  // Resolve deposit user emails
  const userMap: Record<string, { email: string; name: string | null }> = {}
  for (const u of users) {
    userMap[u.id] = { email: u.email, name: u.name }
  }

  return (
    <div className="flex min-h-screen bg-[#060609] text-white">
      {/* Mobile sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed left-4 top-4 z-50 rounded-lg bg-white/10 p-2 text-white/70 backdrop-blur-lg lg:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-white/10 bg-[#0a0a0f] transition-transform lg:static lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Brand */}
        <div className="flex h-16 items-center gap-2 border-b border-white/10 px-5">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-xs font-bold">N</div>
          <div>
            <div className="text-sm font-semibold">{partner.name}</div>
            <div className="text-[10px] text-white/40">Partner Dashboard</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <NavItem
              key={item.key}
              label={item.label}
              icon={item.icon}
              active={section === item.key}
              onClick={() => {
                setSection(item.key)
                setSidebarOpen(false)
              }}
            />
          ))}
        </nav>

        {/* Bottom */}
        <div className="border-t border-white/10 p-3 space-y-1">
          <a
            href="/developers"
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/50 hover:bg-white/5 hover:text-white/70 transition-colors"
          >
            <span className="text-base">📖</span>
            Docs
            <span className="ml-auto text-xs text-white/30">↗</span>
          </a>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/50 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <span className="text-base">🚪</span>
            Logout
          </button>
        </div>
      </aside>

      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">
          {/* Stats row (always visible) */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Total Wallets" value={String(stats.totalWallets)} />
            <StatCard
              label="Total Balance"
              value={`${stats.totalBalanceTzs.toLocaleString()} TZS`}
              sub="Across all wallets"
            />
            <StatCard
              label="Platform Earnings"
              value={`${partner.treasuryBalanceTzs.toLocaleString()} TZS`}
              sub={partner.feePercent > 0 ? `${partner.feePercent}% fee` : 'No fee set'}
            />
            <StatCard label="Transactions" value={String(stats.totalTransfers)} />
            <StatCard label="Deposits" value={String(stats.totalDeposits)} />
          </div>

          {/* Quick Actions */}
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/developers"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10 transition-colors"
            >
              <span>+</span> Create Wallet
            </a>
            <button
              onClick={() => setShowSendModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90 transition-colors"
            >
              <span>↗</span> Send TZS
            </button>
            <a
              href="/developers"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10 transition-colors"
            >
              <span>↓</span> Fund Wallet
            </a>
          </div>

          {/* Section content */}
          <div className="mt-8">
            {/* ── Overview ── */}
            {section === 'overview' && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold">Recent Activity</h2>

                {/* Recent transfers */}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-white/60">Recent Transfers</h3>
                    <button onClick={() => setSection('transfers')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
                  </div>
                  {transfers.length === 0 ? (
                    <p className="text-sm text-white/30">No transfers yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {transfers.slice(0, 5).map((t) => (
                        <div key={t.id} className="flex items-center justify-between rounded-xl bg-white/[0.02] px-4 py-3">
                          <div>
                            <div className="text-sm">{t.fromName || t.fromEmail || t.fromUserId.slice(0, 8)} → {t.toName || t.toEmail || t.toUserId.slice(0, 8)}</div>
                            <div className="text-xs text-white/40">{formatDateEAT(t.createdAt)}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium">{t.amountTzs.toLocaleString()} TZS</span>
                            <StatusBadge status={t.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent deposits */}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-white/60">Recent Deposits</h3>
                    <button onClick={() => setSection('deposits')} className="text-xs text-blue-400 hover:text-blue-300">View all →</button>
                  </div>
                  {deposits.length === 0 ? (
                    <p className="text-sm text-white/30">No deposits yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {deposits.slice(0, 5).map((d) => (
                        <div key={d.id} className="flex items-center justify-between rounded-xl bg-white/[0.02] px-4 py-3">
                          <div>
                            <div className="text-sm">{userMap[d.userId]?.name || userMap[d.userId]?.email || d.userId.slice(0, 8)}</div>
                            <div className="text-xs text-white/40">{formatDateEAT(d.createdAt)}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium">{d.amountTzs.toLocaleString()} TZS</span>
                            <StatusBadge status={d.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Wallets ── */}
            {section === 'wallets' && (
              <div>
                <h2 className="text-lg font-semibold mb-4">Wallets</h2>
                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Email</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">External ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Wallet Address</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Label</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-white/40">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Treasury wallet row */}
                      {partner.treasuryWalletAddress && (
                        <tr className="border-b border-white/5 bg-emerald-500/[0.03]">
                          <td className="px-4 py-3 font-medium text-emerald-400">{partner.name}</td>
                          <td className="px-4 py-3 text-white/50">{partner.email || '—'}</td>
                          <td className="px-4 py-3 font-mono text-xs text-white/40">—</td>
                          <td className="px-4 py-3 font-mono text-xs text-white/50">
                            {partner.treasuryWalletAddress.slice(0, 6)}...{partner.treasuryWalletAddress.slice(-4)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                              Treasury
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-emerald-400">
                            {partner.treasuryBalanceTzs.toLocaleString()} TZS
                          </td>
                        </tr>
                      )}
                      {/* User wallets */}
                      {users.length === 0 && !partner.treasuryWalletAddress ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-white/40">
                            No wallets yet. Create your first wallet via the API.
                          </td>
                        </tr>
                      ) : (
                        users.map((u) => (
                          <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-4 py-3 text-white/80">{u.name || '—'}</td>
                            <td className="px-4 py-3 text-white/60">{u.email}</td>
                            <td className="px-4 py-3 font-mono text-xs text-white/50">{u.externalId}</td>
                            <td className="px-4 py-3 font-mono text-xs text-white/50">
                              {u.walletAddress
                                ? `${u.walletAddress.slice(0, 6)}...${u.walletAddress.slice(-4)}`
                                : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-300">
                                User
                              </span>
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
              </div>
            )}

            {/* ── Transfers ── */}
            {section === 'transfers' && (
              <div>
                <h2 className="text-lg font-semibold mb-4">Transfers</h2>
                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">From</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">To</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-white/40">Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Tx Hash</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transfers.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-white/40">
                            No transfers yet.
                          </td>
                        </tr>
                      ) : (
                        transfers.map((t) => (
                          <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-4 py-3 text-white/70 text-xs">{t.fromName || t.fromEmail || t.fromUserId.slice(0, 8)}</td>
                            <td className="px-4 py-3 text-white/70 text-xs">{t.toName || t.toEmail || t.toUserId.slice(0, 8)}</td>
                            <td className="px-4 py-3 text-right font-mono text-white/80">
                              {t.amountTzs.toLocaleString()} TZS
                            </td>
                            <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                            <td className="px-4 py-3 font-mono text-xs text-white/40">
                              {t.txHash ? `${t.txHash.slice(0, 10)}...` : '—'}
                            </td>
                            <td className="px-4 py-3 text-xs text-white/40">{formatDateEAT(t.createdAt)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Deposits ── */}
            {section === 'deposits' && (
              <div>
                <h2 className="text-lg font-semibold mb-4">Deposits</h2>
                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">User</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-white/40">Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Reference</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deposits.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-white/40">
                            No deposits yet.
                          </td>
                        </tr>
                      ) : (
                        deposits.map((d) => (
                          <tr key={d.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-4 py-3 font-mono text-xs text-white/50">{d.id.slice(0, 8)}...</td>
                            <td className="px-4 py-3 text-xs text-white/70">{userMap[d.userId]?.name || userMap[d.userId]?.email || d.userId.slice(0, 8)}</td>
                            <td className="px-4 py-3 text-right font-mono text-white/80">
                              {d.amountTzs.toLocaleString()} TZS
                            </td>
                            <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                            <td className="px-4 py-3 font-mono text-xs text-white/40">{d.pspReference || '—'}</td>
                            <td className="px-4 py-3 text-xs text-white/40">{formatDateEAT(d.createdAt)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Treasury ── */}
            {section === 'treasury' && (
              <TreasurySection partner={partner} onRefresh={fetchDashboard} />
            )}

            {/* ── Settings ── */}
            {section === 'settings' && (
              <SettingsSection partner={partner} onRefresh={fetchDashboard} />
            )}
          </div>
        </div>
      </main>

      {/* Send Modal */}
      {showSendModal && (
        <SendModal
          users={users}
          onClose={() => setShowSendModal(false)}
          onSuccess={fetchDashboard}
        />
      )}
    </div>
  )
}
