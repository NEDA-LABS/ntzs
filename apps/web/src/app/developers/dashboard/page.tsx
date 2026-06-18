'use client'

import { useEffect, useState, useCallback, useRef, type ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { formatDateEAT } from '@/lib/format-date'
import {
  IconActivity,
  IconArrowDown,
  IconBank,
  IconChevronRight,
  IconCoins,
  IconDashboard,
  IconLink,
  IconPlus,
  IconSend,
  IconShield,
  IconWallet,
} from '@/app/app/_components/icons'

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
  capabilities: string[]
  payoutPhone: string | null
  payoutType: string
  payoutBankAccount: string | null
  payoutBankName: string | null
  createdAt: string
  updatedAt: string
}

interface DashboardUser {
  id: string
  externalId: string
  walletIndex: number | null
  email: string
  name: string | null
  phone: string | null
  walletId: string | null
  walletAddress: string | null
  walletFrozen: boolean
  walletCreatedAt: string | null
  balanceTzs: number
  balanceUsdc: number
  totalTransfers: number
  totalSent: number
  totalReceived: number
  totalDeposited: number
  totalDepositCount: number
  lastTransferAt: string | null
  createdAt: string
  updatedAt: string
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
  updatedAt: string
}

interface DashboardDeposit {
  id: string
  userId: string
  userEmail: string | null
  userName: string | null
  amountTzs: number
  status: string
  pspReference: string | null
  pspChannel: string | null
  payerName: string | null
  buyerPhone: string | null
  fiatConfirmedAt: string | null
  mintedAt: string | null
  createdAt: string
  updatedAt: string
  destWalletAddress: string | null
}

interface DashboardSubWallet {
  id: string
  label: string
  address: string
  walletIndex: number
  balanceTzs: number
  createdAt: string
}

interface ActivityItem {
  type: 'transfer' | 'deposit'
  id: string
  createdAt: string
  updatedAt: string
  amountTzs: number
  status: string
  fromEmail?: string | null
  fromName?: string | null
  toEmail?: string | null
  toName?: string | null
  txHash?: string | null
  userEmail?: string | null
  userName?: string | null
  pspChannel?: string | null
}

interface CapabilityCatalogItem { id: string; label: string; description: string; kybRequired: boolean }

interface DashboardData {
  partner: PartnerInfo
  capabilityCatalog: CapabilityCatalogItem[]
  users: DashboardUser[]
  subWallets: DashboardSubWallet[]
  transfers: DashboardTransfer[]
  deposits: DashboardDeposit[]
  pendingTransfers: DashboardTransfer[]
  pendingDeposits: DashboardDeposit[]
  recentActivity: ActivityItem[]
  stats: {
    totalUsers: number
    totalWallets: number
    totalBalanceTzs: number
    totalTransfers: number
    totalDeposits: number
    pendingTransfers: number
    pendingDeposits: number
  }
}

type Section = 'overview' | 'wallets' | 'transfers' | 'deposits' | 'treasury' | 'ramp' | 'catalog' | 'billing' | 'kyb' | 'settings'

/* ── Custom Select ── */
type SelectOption = { value: string; label: string; sub?: string }
type SelectGroup = { group: string; options: SelectOption[] }
type SelectItem = SelectOption | SelectGroup

function isGroup(item: SelectItem): item is SelectGroup {
  return 'group' in item
}

function CustomSelect({
  value,
  onChange,
  items,
  placeholder = 'Select...',
}: {
  value: string
  onChange: (value: string) => void
  items: SelectItem[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const allOptions: SelectOption[] = items.flatMap((item) =>
    isGroup(item) ? item.options : [item]
  )
  const selected = allOptions.find((o) => o.value === value)
  const displayLabel = selected?.label ?? placeholder

  const handleSelect = (val: string) => {
    onChange(val)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white hover:border-white/20 focus:outline-none"
      >
        <span className={selected ? 'text-white' : 'text-white/30'}>{displayLabel}</span>
        <svg
          className={`h-4 w-4 text-white/30 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-[#111118] shadow-2xl">
          <div className="max-h-60 overflow-y-auto py-1">
            {items.map((item, i) =>
              isGroup(item) ? (
                item.options.length > 0 ? (
                  <div key={i}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">
                      {item.group}
                    </div>
                    {item.options.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleSelect(opt.value)}
                        className={`flex w-full items-center justify-between px-4 py-2 text-sm transition-colors hover:bg-white/[0.06] ${
                          opt.value === value ? 'text-white' : 'text-white/70'
                        }`}
                      >
                        <span>{opt.label}</span>
                        {opt.value === value && (
                          <svg className="h-3.5 w-3.5 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                ) : null
              ) : (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => handleSelect(item.value)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-white/[0.06] ${
                    item.value === value ? 'text-white' : 'text-white/70'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.value === value && (
                    <svg className="h-3.5 w-3.5 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
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

/* ── Sidebar Nav Item ── */
function NavItem({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string
  icon: ComponentType<{ className?: string }>
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex w-full items-center gap-3 rounded-xl py-2.5 pl-4 pr-3 text-sm font-medium transition-all duration-200 ${
        active ? 'bg-white/[0.07] text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/70'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-emerald-400/70" />
      )}
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

/* ── Disburse Modal (treasury or sub-wallet → user) ── */
function DisburseModal({
  users,
  subWallets,
  partner,
  onClose,
  onSuccess,
}: {
  users: DashboardUser[]
  subWallets: DashboardSubWallet[]
  partner: PartnerInfo
  onClose: () => void
  onSuccess: () => void
}) {
  const [fromSubWalletId, setFromSubWalletId] = useState<string>('')
  const [toType, setToType] = useState<'user' | 'subwallet'>('user')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const selectedSubWallet = subWallets.find((sw) => sw.id === fromSubWalletId) ?? null
  const availableBalance = selectedSubWallet
    ? selectedSubWallet.balanceTzs
    : partner.treasuryBalanceTzs
  const sourceAddress = selectedSubWallet
    ? selectedSubWallet.address
    : partner.treasuryWalletAddress
  const sourceLabel = selectedSubWallet ? selectedSubWallet.label : `${partner.name} Treasury`

  const handleDisburse = async () => {
    if (!toId || !amount) {
      setError('All fields are required')
      return
    }
    const amountNum = Number(amount)
    if (!amountNum || amountNum <= 0) {
      setError('Enter a valid amount')
      return
    }
    if (amountNum > availableBalance) {
      setError(`Exceeds ${sourceLabel} balance (${availableBalance.toLocaleString()} TZS)`)
      return
    }
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/v1/partners/disburse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amountTzs: amountNum,
          ...(fromSubWalletId ? { fromSubWalletId } : {}),
          ...(toType === 'subwallet' ? { toSubWalletId: toId } : { toUserId: toId }),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Disbursement failed')
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
        <h3 className="text-lg font-semibold">Disburse TZS</h3>
        <p className="mt-1 text-sm text-white/50">Send funds from a partner wallet to a user wallet</p>

        <div className="mt-5 space-y-4">
          {/* From: treasury or sub-wallet picker */}
          <div>
            <label className="text-xs font-medium text-white/40">From</label>
            <CustomSelect
              value={fromSubWalletId}
              onChange={(val) => { setFromSubWalletId(val); setToId(''); setToType('user') }}
              placeholder="Treasury"
              items={[
                { value: '', label: `Treasury (${partner.treasuryBalanceTzs.toLocaleString()} TZS)` },
                ...subWallets.map((sw) => ({
                  value: sw.id,
                  label: `${sw.label} (${sw.balanceTzs.toLocaleString()} TZS)`,
                })),
              ]}
            />
            {sourceAddress && (
              <div className="mt-1 font-mono text-[11px] text-white/30">
                {sourceAddress.slice(0, 10)}...{sourceAddress.slice(-6)}
              </div>
            )}
          </div>

          {/* To: user or sub-wallet picker */}
          <div>
            <label className="text-xs font-medium text-white/40">To</label>
            <CustomSelect
              value={toType === 'subwallet' ? `sw:${toId}` : toId ? `user:${toId}` : ''}
              onChange={(val) => {
                if (val.startsWith('sw:')) {
                  setToType('subwallet')
                  setToId(val.slice(3))
                } else if (val.startsWith('user:')) {
                  setToType('user')
                  setToId(val.slice(5))
                }
              }}
              placeholder="Select destination"
              items={[
                ...(users.length > 0
                  ? [{
                      group: 'User Wallets',
                      options: users.map((u) => ({
                        value: `user:${u.id}`,
                        label: u.name || u.email,
                      })),
                    }]
                  : []),
                ...(subWallets.filter((sw) => sw.id !== fromSubWalletId).length > 0
                  ? [{
                      group: 'Sub-wallets',
                      options: subWallets
                        .filter((sw) => sw.id !== fromSubWalletId)
                        .map((sw) => ({
                          value: `sw:${sw.id}`,
                          label: `${sw.label} (${sw.balanceTzs.toLocaleString()} TZS)`,
                        })),
                    }]
                  : []),
              ]}
            />
          </div>

          {/* Amount */}
          <div>
            <label className="text-xs font-medium text-white/40">Amount (TZS)</label>
            <input
              type="number"
              min={1}
              max={availableBalance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
            />
            <div className="mt-1 text-[11px] text-white/30">
              Available: {availableBalance.toLocaleString()} TZS
            </div>
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        {success && <p className="mt-3 text-xs text-emerald-400">Disbursement sent successfully!</p>}

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleDisburse}
            disabled={sending || success}
            className="flex-1 rounded-xl bg-white py-2.5 text-sm font-semibold text-black hover:bg-white/90 transition-colors disabled:opacity-50"
          >
            {sending ? 'Disbursing...' : success ? 'Done!' : 'Disburse TZS'}
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

/* ── Create Sub-Wallet Modal ── */
const SUB_WALLET_PRESETS = ['Escrow', 'Reserves', 'Settlement', 'Disbursement', 'Fees', 'Custom']

function CreateWalletModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ label: string; address: string; derivationPath: string } | null>(null)

  const handleCreate = async () => {
    if (!label.trim()) {
      setError('Wallet label is required')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/partners/sub-wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ label: label.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed to create sub-wallet')
        return
      }
      setResult(json)
      onSuccess()
    } catch {
      setError('Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0f] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {result ? (
          <>
            <h3 className="text-lg font-semibold">Sub-wallet Created</h3>
            <p className="mt-1 text-sm text-white/50">
              Your <span className="text-white font-medium">{result.label}</span> wallet is ready
            </p>
            <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
              <div>
                <div className="text-xs text-white/40">Label</div>
                <div className="text-sm font-medium">{result.label}</div>
              </div>
              <div>
                <div className="text-xs text-white/40">Address</div>
                <div className="font-mono text-xs text-emerald-400 break-all mt-0.5">{result.address}</div>
              </div>
              <div>
                <div className="text-xs text-white/40">Derivation Path</div>
                <div className="font-mono text-xs text-white/40 mt-0.5">{result.derivationPath}</div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="mt-5 w-full rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm text-white/70 hover:bg-white/10 transition-colors"
            >
              Done
            </button>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold">Create Sub-wallet</h3>
            <p className="mt-1 text-sm text-white/50">
              Add a partner-controlled wallet for internal fund separation
            </p>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50">
              Sub-wallets are derived from your treasury HD seed — fully controlled by your platform, separate from user wallets. Use them to segregate funds by purpose.
            </div>

            <div className="mt-4">
              <label className="text-xs font-medium text-white/40">Wallet Label</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {SUB_WALLET_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setLabel(preset === 'Custom' ? '' : preset)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      label === preset
                        ? 'border-white/40 bg-white/10 text-white'
                        : 'border-white/10 bg-white/[0.03] text-white/50 hover:bg-white/[0.07] hover:text-white/70'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                type="text"
                maxLength={50}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="or type a custom label"
                className="mt-3 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
              />
            </div>

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

            <div className="mt-5 flex gap-3">
              <button
                onClick={handleCreate}
                disabled={loading || !label.trim()}
                className="flex-1 rounded-xl bg-white py-2.5 text-sm font-semibold text-black hover:bg-white/90 transition-colors disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Create Sub-wallet'}
              </button>
              <button
                onClick={onClose}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm text-white/70 hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Fund Wallet Modal ── */
function FundWalletModal({ partner, onClose, onSuccess }: { partner: PartnerInfo; onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleFund = async () => {
    const amountNum = Number(amount)
    if (!amountNum || amountNum < 500) {
      setError('Minimum deposit is 500 TZS')
      return
    }
    if (!phone) {
      setError('Phone number is required')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/partners/fund-treasury', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amountTzs: amountNum, phoneNumber: phone }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Deposit failed')
        return
      }
      setSubmitted(true)
      onSuccess()
    } catch {
      setError('Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0f] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {submitted ? (
          <>
            <h3 className="text-lg font-semibold">Payment Prompt Sent</h3>
            <p className="mt-1 text-sm text-white/50">Check your phone for the M-Pesa payment prompt.</p>
            <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-1 text-sm text-white/70">
              <p>Once you approve the payment, TZS will be minted as nTZS and credited to your treasury wallet.</p>
              <p className="mt-2 text-xs text-white/40">This may take up to a few minutes.</p>
            </div>
            <button
              onClick={onClose}
              className="mt-5 w-full rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm text-white/70 hover:bg-white/10 transition-colors"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold">Fund Treasury</h3>
            <p className="mt-1 text-sm text-white/50">
              Deposit TZS via M-Pesa — funds are minted as nTZS to your treasury wallet
            </p>

            {/* Treasury balance summary */}
            <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="text-xs text-white/40">Current Treasury Balance</div>
              <div className="text-sm font-semibold text-emerald-400">
                {partner.treasuryBalanceTzs.toLocaleString()} TZS
              </div>
            </div>

            {!partner.treasuryWalletAddress && (
              <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-400">
                Treasury wallet not yet provisioned. Create a user wallet first.
              </div>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-white/40">Amount (TZS) <span className="text-white/20">— min 500</span></label>
                <input
                  type="number"
                  min={500}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 50000"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-white/40">M-Pesa Phone Number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+255 700 000 000"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
                />
              </div>
            </div>

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

            <div className="mt-5 flex gap-3">
              <button
                onClick={handleFund}
                disabled={loading || !partner.treasuryWalletAddress}
                className="flex-1 rounded-xl bg-white py-2.5 text-sm font-semibold text-black hover:bg-white/90 transition-colors disabled:opacity-50"
              >
                {loading ? 'Initiating...' : 'Fund via M-Pesa'}
              </button>
              <button
                onClick={onClose}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm text-white/70 hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Billing Section ── */
interface BillingData {
  joiningFeeUsd: number
  joiningFeePaid: boolean
  joiningFeePaidAt: string | null
  pilotEndsAt: string | null
  pilotActive: boolean
  walletAllocation: number
  contractEndAt: string | null
  monthlyFeeUsd: number
  contractSignedAt: string | null
}

interface Invoice {
  id: string
  type: string
  amountUsd: string
  status: string
  periodStart: string | null
  periodEnd: string | null
  dueAt: string | null
  paidAt: string | null
  paymentMethod: string | null
  paymentRef: string | null
  lateInterestUsd: string
  notes: string | null
  createdAt: string
}

interface PaymentInstructions {
  usdc: { network: string; tokenAddress: string; recipientAddress: string | null }
  bankTransfer: {
    bankName: string | null
    accountName: string | null
    accountNumber: string | null
    swiftCode: string | null
    currency: string
    reference: string
  }
}

function BillingSection({ partner: _partner }: { partner: PartnerInfo }) {
  const [billing, setBilling] = useState<BillingData | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payment, setPayment] = useState<PaymentInstructions | null>(null)
  const [loading, setLoading] = useState(true)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const copy = (value: string, field: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    })
  }

  useEffect(() => {
    fetch('/api/v1/partners/billing', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        setBilling(d.billing)
        setInvoices(d.invoices ?? [])
        setPayment(d.paymentInstructions)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-6 text-sm text-white/40">Loading billing…</div>

  const statusColor: Record<string, string> = {
    pending: 'bg-amber-500/10 text-amber-300',
    paid: 'bg-emerald-500/10 text-emerald-300',
    overdue: 'bg-red-500/10 text-red-300',
    void: 'bg-white/5 text-white/40',
  }

  return (
    <div className="space-y-6">
      {/* Plan cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Joining fee */}
        <div className={`rounded-2xl border p-5 ${billing?.joiningFeePaid ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
          <div className="text-xs font-medium text-white/40 uppercase tracking-wide">One-time joining fee</div>
          <div className="mt-2 text-3xl font-bold text-white">${billing?.joiningFeeUsd?.toLocaleString() ?? '50,000'}</div>
          <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${billing?.joiningFeePaid ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
            {billing?.joiningFeePaid ? `Paid ${billing.joiningFeePaidAt ? formatDateEAT(new Date(billing.joiningFeePaidAt)) : ''}` : 'Pending payment'}
          </span>
        </div>

        {/* Pilot period */}
        <div className={`rounded-2xl border p-5 ${billing?.pilotActive ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/10 bg-white/5'}`}>
          <div className="text-xs font-medium text-white/40 uppercase tracking-wide">Pilot period</div>
          <div className={`mt-2 text-3xl font-bold ${billing?.pilotActive ? 'text-emerald-400' : 'text-white/50'}`}>
            {billing?.pilotActive ? 'Active' : billing?.pilotEndsAt ? 'Ended' : 'Not started'}
          </div>
          {billing?.pilotEndsAt ? (
            <div className="mt-1 text-xs text-white/40">
              {billing.pilotActive ? 'Ends' : 'Ended'} {formatDateEAT(new Date(billing.pilotEndsAt))}
            </div>
          ) : (
            <div className="mt-1 text-xs text-white/30">3 months free after joining fee clears</div>
          )}
        </div>

        {/* Monthly SaaS */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs font-medium text-white/40 uppercase tracking-wide">Monthly SaaS fee</div>
          <div className="mt-2 text-3xl font-bold text-white">
            ${billing?.monthlyFeeUsd?.toLocaleString() ?? '2,000'}<span className="text-sm font-normal text-white/30">/mo</span>
          </div>
          <div className="mt-1 text-xs text-white/30">From Month 4 · +0.2% mint/redeem · +0.1% swap</div>
        </div>
      </div>

      {/* Payment instructions */}
      {payment && (
        <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="border-b border-white/[0.06] px-5 py-4">
            <h3 className="text-sm font-semibold text-white">Payment instructions</h3>
          </div>
          <div className="divide-y divide-white/[0.06] px-5 py-4 space-y-4">
            {/* USDC */}
            <div className="pb-4">
              <p className="text-xs font-medium text-white/40 uppercase tracking-wide mb-2">USDC on {payment.usdc.network}</p>
              {payment.usdc.recipientAddress ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-xs font-mono text-white/70">
                    {payment.usdc.recipientAddress}
                  </code>
                  <button
                    onClick={() => copy(payment.usdc.recipientAddress!, 'usdc')}
                    className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60 hover:bg-white/10 transition-colors"
                  >
                    {copiedField === 'usdc' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-white/30">Treasury address not configured — contact support</p>
              )}
            </div>

            {/* Bank transfer */}
            <div className="pt-4">
              <p className="text-xs font-medium text-white/40 uppercase tracking-wide mb-2">Bank transfer</p>
              {payment.bankTransfer.bankName ? (
                <div className="rounded-xl border border-white/10 bg-black/20 divide-y divide-white/[0.06] overflow-hidden">
                  {[
                    ['Bank', payment.bankTransfer.bankName, false],
                    ['Account name', payment.bankTransfer.accountName, false],
                    ['Account number', payment.bankTransfer.accountNumber, true],
                    ['Swift / BIC', payment.bankTransfer.swiftCode, true],
                    ['Currency', payment.bankTransfer.currency, false],
                  ].map(([label, value]) => value ? (
                    <div key={String(label)} className="flex items-center justify-between px-4 py-2.5 text-xs">
                      <span className="text-white/40 shrink-0">{label}</span>
                      <span className="font-mono font-medium text-white/80 ml-4 text-right">{String(value)}</span>
                    </div>
                  ) : null)}
                  <div className="flex items-center justify-between px-4 py-2.5 text-xs">
                    <span className="text-white/40 shrink-0">Reference</span>
                    <div className="flex items-center gap-2 ml-4">
                      <span className="font-mono font-medium text-amber-300">{payment.bankTransfer.reference}</span>
                      <button
                        onClick={() => copy(payment.bankTransfer.reference, 'ref')}
                        className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50 hover:bg-white/10 transition-colors"
                      >
                        {copiedField === 'ref' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-white/30">Bank details coming soon — contact your account manager</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Invoices */}
      <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="border-b border-white/[0.06] px-5 py-4">
          <h3 className="text-sm font-semibold text-white">Invoices</h3>
        </div>
        {invoices.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-white/30">No invoices yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-white/[0.03] text-white/40 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Due</th>
                  <th className="px-4 py-3 text-left font-medium">Paid</th>
                  <th className="px-4 py-3 text-left font-medium">Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 font-medium text-white/80 capitalize">{inv.type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-right font-mono text-white/80">${parseFloat(String(inv.amountUsd)).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusColor[inv.status] ?? 'bg-white/5 text-white/40'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/40">{inv.dueAt ? formatDateEAT(new Date(inv.dueAt)) : '—'}</td>
                    <td className="px-4 py-3 text-white/40">{inv.paidAt ? formatDateEAT(new Date(inv.paidAt)) : '—'}</td>
                    <td className="px-4 py-3 font-mono text-white/30">{inv.paymentRef ?? '—'}</td>
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

/* ── KYB Section ── */
interface KybData {
  id: string
  status: string
  businessLegalName: string | null
  registrationNumber: string | null
  registeredAddress: string | null
  authorizedRepName: string | null
  authorizedRepTitle: string | null
  authorizedRepEmail: string | null
  licenseType: string | null
  licenseNumber: string | null
  issuingAuthority: string | null
  jurisdiction: string | null
  certOfIncorporationUrl: string | null
  regulatoryLicenseUrl: string | null
  amlPolicyUrl: string | null
  reviewNotes: string | null
  submittedAt: string | null
}

const KYB_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  not_started: { label: 'Not started', color: 'bg-white/5 text-white/40' },
  submitted: { label: 'Submitted', color: 'bg-blue-500/10 text-blue-300' },
  under_review: { label: 'Under review', color: 'bg-amber-500/10 text-amber-300' },
  approved: { label: 'Approved', color: 'bg-emerald-500/10 text-emerald-300' },
  rejected: { label: 'Rejected', color: 'bg-red-500/10 text-red-300' },
}

function KybSection({ partner: _partner }: { partner: PartnerInfo }) {
  const [kyb, setKyb] = useState<KybData | null>(null)
  const [form, setForm] = useState<Partial<KybData>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [uploading, setUploading] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetch('/api/v1/partners/kyb', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        setKyb(d.kyb)
        if (d.kyb) setForm(d.kyb)
      })
      .finally(() => setLoading(false))
  }, [])

  const locked = kyb?.status === 'approved' || kyb?.status === 'under_review'

  const handleChange = (key: keyof KybData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleUpload = async (docType: string, file: File) => {
    setUploading((u) => ({ ...u, [docType]: true }))
    setError('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('docType', docType)
    const res = await fetch('/api/v1/partners/kyb/upload', { method: 'POST', credentials: 'same-origin', body: fd })
    const data = await res.json() as { url?: string; error?: string }
    if (!res.ok) { setError(data.error ?? 'Upload failed'); setUploading((u) => ({ ...u, [docType]: false })); return }
    const keyMap: Record<string, keyof KybData> = {
      cert_of_incorporation: 'certOfIncorporationUrl',
      regulatory_license: 'regulatoryLicenseUrl',
      aml_policy: 'amlPolicyUrl',
    }
    const field = keyMap[docType]
    if (field) setForm((prev) => ({ ...prev, [field]: data.url }))
    setUploading((u) => ({ ...u, [docType]: false }))
  }

  const handleSave = async (submit = false) => {
    setSaving(true); setError(''); setSuccess('')
    const payload = { ...form, submit: submit ? 'true' : 'false' }
    const res = await fetch('/api/v1/partners/kyb', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json() as { kyb?: KybData; error?: string }
    setSaving(false)
    if (!res.ok) { setError(data.error ?? 'Save failed'); return }
    setKyb(data.kyb!)
    setSuccess(submit ? 'KYB submitted for review' : 'Saved')
    setTimeout(() => setSuccess(''), 3000)
  }

  if (loading) return <div className="p-6 text-sm text-white/40">Loading KYB…</div>

  const status = KYB_STATUS_LABELS[kyb?.status ?? 'not_started']

  const field = (label: string, key: keyof KybData, placeholder = '') => (
    <div>
      <label className="block text-xs font-medium text-white/40 mb-1">{label}</label>
      <input
        type="text"
        value={(form[key] as string) ?? ''}
        onChange={(e) => handleChange(key, e.target.value)}
        placeholder={placeholder}
        disabled={locked}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-white/30 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
      />
    </div>
  )

  const uploadField = (label: string, docType: string, urlKey: keyof KybData) => (
    <div>
      <label className="block text-xs font-medium text-white/40 mb-1.5">{label}</label>
      {(form[urlKey] as string) ? (
        <div className="flex items-center gap-2">
          <a href={form[urlKey] as string} target="_blank" rel="noopener noreferrer"
            className="flex-1 truncate rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-mono text-white/60 hover:text-white/80 transition-colors">
            {(form[urlKey] as string).split('/').pop()}
          </a>
          {!locked && (
            <label className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/50 hover:bg-white/10 transition-colors">
              {uploading[docType] ? 'Uploading…' : 'Replace'}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => e.target.files?.[0] && handleUpload(docType, e.target.files[0])} />
            </label>
          )}
        </div>
      ) : (
        <label className={`flex items-center justify-center rounded-xl border-2 border-dashed px-4 py-4 text-sm transition-colors ${locked ? 'cursor-default border-white/5 text-white/20' : 'cursor-pointer border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'}`}>
          {uploading[docType] ? 'Uploading…' : `Upload ${label} (PDF / image, max 10 MB)`}
          {!locked && <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => e.target.files?.[0] && handleUpload(docType, e.target.files[0])} />}
        </label>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Know Your Business (KYB)</h2>
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${status.color}`}>{status.label}</span>
      </div>

      {kyb?.reviewNotes && kyb.status === 'rejected' && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          <strong className="text-red-200">Review notes:</strong> {kyb.reviewNotes}
        </div>
      )}
      {locked && kyb?.status === 'approved' && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
          KYB approved. Contact support to update any details.
        </div>
      )}

      {/* Business details */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white/80">Business details</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field('Legal business name', 'businessLegalName', 'ACME Financial Ltd')}
          {field('Registration number', 'registrationNumber', 'REG-12345678')}
          {field('Authorized rep name', 'authorizedRepName', 'Jane Doe')}
          {field('Title / role', 'authorizedRepTitle', 'CEO')}
          {field('Authorized rep email', 'authorizedRepEmail', 'jane@acme.com')}
        </div>
        <div>
          <label className="block text-xs font-medium text-white/40 mb-1">Registered address</label>
          <textarea
            value={(form.registeredAddress as string) ?? ''}
            onChange={(e) => handleChange('registeredAddress', e.target.value)}
            placeholder="Full registered business address"
            disabled={locked}
            rows={2}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-white/30 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed resize-none"
          />
        </div>
      </div>

      {/* Regulatory license */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white/80">Regulatory license</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field('License type', 'licenseType', 'e.g. Payment Institution')}
          {field('License number', 'licenseNumber')}
          {field('Issuing authority', 'issuingAuthority', 'e.g. Bank of Tanzania')}
          {field('Jurisdiction', 'jurisdiction', 'e.g. Tanzania')}
        </div>
      </div>

      {/* Document uploads */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white/80">Supporting documents</h3>
        {uploadField('Certificate of Incorporation', 'cert_of_incorporation', 'certOfIncorporationUrl')}
        {uploadField('Regulatory License', 'regulatory_license', 'regulatoryLicenseUrl')}
        {uploadField('AML / CFT Policy', 'aml_policy', 'amlPolicyUrl')}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-emerald-400">{success}</p>}

      {!locked && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10 transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-white/90 transition-colors disabled:opacity-40"
          >
            {saving ? 'Submitting…' : 'Submit for review'}
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Treasury Section ── */
function TreasurySection({ partner, onRefresh }: { partner: PartnerInfo; onRefresh: () => void }) {
  const [feeInput, setFeeInput] = useState(String(partner.feePercent))
  const [feeSaving, setFeeSaving] = useState(false)
  const [feeError, setFeeError] = useState('')
  const [feeSuccess, setFeeSuccess] = useState(false)
  const [copied, setCopied] = useState(false)

  // Payout destination configuration
  const [showConfigurePane, setShowConfigurePane] = useState(false)
  const [configureTab, setConfigureTab] = useState<'mobile' | 'bank'>('mobile')
  const [payoutPhone, setPayoutPhone] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [bankName, setBankName] = useState('')
  const [configureSaving, setConfigureSaving] = useState(false)
  const [configureError, setConfigureError] = useState('')

  // Withdraw
  const [amountInput, setAmountInput] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const [withdrawSuccess, setWithdrawSuccess] = useState('')
  // Stable across retries of the same withdrawal so a network retry can't
  // double-withdraw; regenerated after a confirmed success.
  const withdrawIdemKeyRef = useRef<string | null>(null)

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
      if (!res.ok) { setFeeError(json.error || 'Failed to update fee'); return }
      setFeeSuccess(true)
      onRefresh()
      setTimeout(() => setFeeSuccess(false), 3000)
    } catch {
      setFeeError('Failed to connect to server')
    } finally {
      setFeeSaving(false)
    }
  }

  const handleSaveDestination = async () => {
    setConfigureSaving(true)
    setConfigureError('')
    try {
      const body = configureTab === 'mobile'
        ? { type: 'mobile', phone: payoutPhone }
        : { type: 'bank', bankAccount, bankName }
      const res = await fetch('/api/v1/partners/treasury/payout-destination', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setConfigureError(json.error || 'Failed to save'); return }
      setShowConfigurePane(false)
      setPayoutPhone('')
      setBankAccount('')
      setBankName('')
      onRefresh()
    } catch {
      setConfigureError('Failed to connect to server')
    } finally {
      setConfigureSaving(false)
    }
  }

  const handleWithdraw = async () => {
    const amount = parseFloat(amountInput)
    if (isNaN(amount) || amount < 5000) {
      setWithdrawError('Minimum withdrawal is 5,000 TZS')
      return
    }
    if (amount > partner.treasuryBalanceTzs) {
      setWithdrawError(`Amount exceeds treasury balance (${partner.treasuryBalanceTzs.toLocaleString()} TZS)`)
      return
    }
    setWithdrawing(true)
    setWithdrawError('')
    setWithdrawSuccess('')
    if (!withdrawIdemKeyRef.current) withdrawIdemKeyRef.current = crypto.randomUUID()
    try {
      const res = await fetch('/api/v1/partners/treasury/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': withdrawIdemKeyRef.current,
        },
        credentials: 'include',
        body: JSON.stringify({ amountTzs: amount }),
      })
      const json = await res.json()
      if (!res.ok) { setWithdrawError(json.error || 'Withdrawal failed'); return }
      setWithdrawSuccess(json.message || `Withdrawal of ${amount.toLocaleString()} TZS initiated. Ref: ${json.reference}`)
      setAmountInput('')
      withdrawIdemKeyRef.current = null
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
          <div className="text-xs font-medium text-white/40">Payout Destination</div>
          {partner.payoutType === 'bank' && partner.payoutBankAccount ? (
            <>
              <div className="mt-2 text-sm font-bold text-white">{partner.payoutBankName}</div>
              <div className="mt-0.5 font-mono text-xs text-white/60">****{partner.payoutBankAccount.slice(-4)}</div>
              <div className="mt-1 text-xs text-white/40">Bank Account</div>
            </>
          ) : partner.payoutPhone ? (
            <>
              <div className="mt-2 font-mono text-sm font-bold text-white">{partner.payoutPhone}</div>
              <div className="mt-1 text-xs text-white/40">M-Pesa / Mobile Money</div>
            </>
          ) : (
            <>
              <div className="mt-2 text-sm font-semibold text-amber-400">Not configured</div>
              <div className="mt-1 text-xs text-white/40">Set before withdrawing</div>
            </>
          )}
        </div>
      </div>

      {/* Treasury wallet address */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold">Treasury Wallet</h3>
            <p className="mt-1 text-sm text-white/50">Your platform earnings wallet. Withdraw to mobile money at any time.</p>
          </div>
          {(partner.payoutPhone || partner.payoutBankAccount) && (
            <button
              onClick={() => {
                setShowConfigurePane(true)
                setConfigureTab(partner.payoutType === 'bank' ? 'bank' : 'mobile')
                setPayoutPhone(partner.payoutPhone ?? '')
                setBankAccount(partner.payoutBankAccount ?? '')
                setBankName(partner.payoutBankName ?? '')
              }}
              className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/50 hover:bg-white/10 hover:text-white transition-colors"
            >
              Change destination
            </button>
          )}
        </div>

        {partner.treasuryWalletAddress && (
          <div className="mt-4 flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-black/30 px-3 py-2 text-xs text-white/60 break-all">
              {partner.treasuryWalletAddress}
            </code>
            <button onClick={copyAddress} className="shrink-0 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/70 hover:bg-white/20 transition-colors">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        {/* No destination configured */}
        {!partner.payoutPhone && !partner.payoutBankAccount && !showConfigurePane && (
          <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="text-sm font-semibold text-amber-300">Configure payout destination first</div>
            <p className="mt-1 text-xs text-amber-200/60">
              Before withdrawing, set the mobile money number where funds will be sent.
            </p>
            <button
              onClick={() => setShowConfigurePane(true)}
              className="mt-3 rounded-xl bg-amber-500/20 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/30 transition-colors"
            >
              Set payout destination
            </button>
          </div>
        )}

        {/* Configure payout destination form */}
        {showConfigurePane && (
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-5 space-y-4">
            <div>
              <h4 className="text-sm font-semibold">Payout Destination</h4>
              <p className="mt-0.5 text-xs text-white/40">Where should treasury funds be sent when you withdraw?</p>
            </div>

            {/* Tab selector */}
            <div className="flex gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
              <button
                onClick={() => setConfigureTab('mobile')}
                className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                  configureTab === 'mobile' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
                }`}
              >
                Mobile Money
              </button>
              <button
                onClick={() => setConfigureTab('bank')}
                className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                  configureTab === 'bank' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
                }`}
              >
                Bank Account
              </button>
            </div>

            {configureTab === 'mobile' ? (
              <div>
                <label className="text-xs font-medium text-white/50">Mobile Money Number</label>
                <input
                  type="tel"
                  placeholder="07XXXXXXXX or 255XXXXXXXXX"
                  value={payoutPhone}
                  onChange={(e) => setPayoutPhone(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/25"
                />
                <p className="mt-1 text-[11px] text-white/30">Supported: Vodacom M-Pesa, Airtel Money, Tigo Pesa, Halo Pesa</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-white/50">Bank Name</label>
                  <input
                    type="text"
                    placeholder="e.g. CRDB, NMB, Equity, Stanbic"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/25"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-white/50">Account Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 0150123456789"
                    value={bankAccount}
                    onChange={(e) => setBankAccount(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/25"
                  />
                </div>
              </div>
            )}

            {configureError && <p className="text-xs text-red-400">{configureError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleSaveDestination}
                disabled={configureSaving || (configureTab === 'mobile' ? !payoutPhone.trim() : (!bankAccount.trim() || !bankName.trim()))}
                className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90 disabled:opacity-50 transition-colors"
              >
                {configureSaving ? 'Saving...' : 'Save destination'}
              </button>
              <button
                onClick={() => { setShowConfigurePane(false); setConfigureError('') }}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs text-white/50 hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Withdraw form — only if destination is configured */}
        {(partner.payoutPhone || (partner.payoutType === 'bank' && partner.payoutBankAccount)) && !showConfigurePane && (
          <div className="mt-5 space-y-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs font-medium text-white/40 mb-2">Withdraw to</div>
              {partner.payoutType === 'bank' && partner.payoutBankAccount ? (
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15">
                    <svg className="h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l9-3 9 3M3 6v14l9 3 9-3V6M3 6l9 3 9-3" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{partner.payoutBankName}</div>
                    <div className="text-[11px] text-white/40">Account ****{partner.payoutBankAccount.slice(-4)} — Bank Transfer</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
                    <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-mono font-semibold text-white">{partner.payoutPhone}</div>
                    <div className="text-[11px] text-white/40">Mobile Money (M-Pesa / Airtel)</div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-white/50">Amount (min. 5,000 TZS)</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="number"
                  min={5000}
                  max={partner.treasuryBalanceTzs}
                  step={100}
                  placeholder="5000"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/25"
                />
                <button
                  onClick={() => setAmountInput(String(partner.treasuryBalanceTzs))}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white/50 hover:bg-white/10 hover:text-white transition-colors"
                >
                  Max
                </button>
              </div>
              <p className="mt-1 text-[11px] text-white/30">
                Available: {partner.treasuryBalanceTzs.toLocaleString()} TZS
              </p>
            </div>

            {withdrawError && <p className="text-xs text-red-400">{withdrawError}</p>}
            {withdrawSuccess && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-300">
                {withdrawSuccess}
              </div>
            )}

            <button
              onClick={handleWithdraw}
              disabled={withdrawing || !amountInput || parseFloat(amountInput) < 5000}
              className="w-full rounded-xl bg-emerald-500/20 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
            >
              {withdrawing ? 'Initiating withdrawal...' : `Withdraw${amountInput ? ` ${parseFloat(amountInput).toLocaleString()} TZS` : ''}`}
            </button>
          </div>
        )}
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

/* ── Wallet Detail Panel ── */
function WalletDetailPanel({
  user,
  transfers,
  deposits,
  onClose,
  onFreezeToggle,
}: {
  user: DashboardUser
  transfers: DashboardTransfer[]
  deposits: DashboardDeposit[]
  onClose: () => void
  onFreezeToggle: (walletId: string, frozen: boolean) => void
}) {
  const [toggling, setToggling] = useState(false)
  const [err, setErr] = useState('')

  const userTransfers = transfers.filter(
    (t) => t.fromUserId === user.id || t.toUserId === user.id
  )

  const userDeposits = deposits.filter((d) => d.userId === user.id)

  type TxEvent =
    | { kind: 'transfer'; data: DashboardTransfer; sortKey: string }
    | { kind: 'deposit'; data: DashboardDeposit; sortKey: string }

  const timeline: TxEvent[] = [
    ...userTransfers.map((t) => ({ kind: 'transfer' as const, data: t, sortKey: t.createdAt })),
    ...userDeposits.map((d) => ({ kind: 'deposit' as const, data: d, sortKey: d.mintedAt ?? d.createdAt })),
  ].sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1))

  const handleToggleFreeze = async () => {
    if (!user.walletId) return
    setToggling(true)
    setErr('')
    try {
      const res = await fetch('/api/v1/partners/wallets/freeze', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ walletId: user.walletId, frozen: !user.walletFrozen }),
      })
      const json = await res.json()
      if (!res.ok) { setErr(json.error || 'Failed'); return }
      onFreezeToggle(user.walletId, json.frozen)
    } catch {
      setErr('Failed to connect to server')
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="relative flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#0a0a0f] shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold">{user.name || user.email}</h3>
            <p className="text-xs text-white/40">User Wallet</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 px-6 py-5">
          {/* Owner details */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
            {[
              { label: 'Name', value: user.name || '—' },
              { label: 'Email', value: user.email },
              { label: 'Phone', value: user.phone || '—' },
              { label: 'External ID', value: user.externalId || '—' },
              { label: 'Wallet Address', value: user.walletAddress || '—', mono: true },
              { label: 'TZS Balance', value: `${user.balanceTzs.toLocaleString()} TZS` },
              { label: 'USDC Balance', value: user.balanceUsdc > 0 ? `${user.balanceUsdc.toFixed(2)} USDC` : '—' },
              { label: 'Created', value: formatDateEAT(user.createdAt) },
            ].map(({ label, value, mono }) => (
              <div key={label} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <span className="text-xs text-white/40 shrink-0">{label}</span>
                <span className={`text-right text-xs text-white/80 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
              </div>
            ))}
          </div>

          {/* Freeze / Unfreeze control */}
          {user.walletId && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Wallet Status</div>
                  <div className="mt-0.5 text-xs text-white/40">
                    {user.walletFrozen
                      ? 'Frozen — all transactions blocked'
                      : 'Active — transactions allowed'}
                  </div>
                </div>
                <button
                  onClick={handleToggleFreeze}
                  disabled={toggling}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    user.walletFrozen
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                      : 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20'
                  }`}
                >
                  {toggling ? '...' : user.walletFrozen ? 'Unfreeze' : 'Freeze'}
                </button>
              </div>
              {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
            </div>
          )}

          {/* Transaction history */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-white/30">
                Transaction History
              </h4>
              <span className="text-[10px] text-white/20">{timeline.length} event{timeline.length !== 1 ? 's' : ''}</span>
            </div>
            {timeline.length === 0 ? (
              <p className="text-sm text-white/30">No transactions yet.</p>
            ) : (
              <div className="space-y-2">
                {timeline.map((event) => {
                  if (event.kind === 'transfer') {
                    const t = event.data
                    const isSender = t.fromUserId === user.id
                    return (
                      <div key={`tx-${t.id}`} className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-semibold uppercase tracking-wide ${isSender ? 'text-red-400' : 'text-emerald-400'}`}>
                              {isSender ? '↑ Sent' : '↓ Received'}
                            </span>
                            <StatusBadge status={t.status} />
                          </div>
                          <span className={`text-sm font-mono font-bold ${isSender ? 'text-red-300' : 'text-emerald-300'}`}>
                            {isSender ? '−' : '+'}{t.amountTzs.toLocaleString()} TZS
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between">
                          <span className="text-xs text-white/40">
                            {isSender
                              ? `To: ${t.toName || t.toEmail || t.toUserId.slice(0, 8)}`
                              : `From: ${t.fromName || t.fromEmail || t.fromUserId.slice(0, 8)}`}
                          </span>
                          <span className="text-[11px] text-white/30">{formatDateEAT(t.createdAt)}</span>
                        </div>
                        {t.txHash && (
                          <a
                            href={`https://basescan.org/tx/${t.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 block font-mono text-[10px] text-white/20 hover:text-white/50 truncate transition-colors"
                          >
                            {t.txHash}
                          </a>
                        )}
                      </div>
                    )
                  }

                  const d = event.data
                  const isMinted = d.status === 'minted'
                  const statusColor = isMinted ? 'text-emerald-400' : d.status.includes('fail') || d.status === 'rejected' ? 'text-red-400' : 'text-amber-400'
                  const ts = d.mintedAt ?? d.fiatConfirmedAt ?? d.createdAt
                  return (
                    <div key={`dep-${d.id}`} className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-semibold uppercase tracking-wide ${statusColor}`}>
                            {isMinted ? '↓ Deposit' : '↓ Deposit'}
                          </span>
                          <StatusBadge status={d.status} />
                        </div>
                        <span className="text-sm font-mono font-bold text-emerald-300">
                          +{d.amountTzs.toLocaleString()} TZS
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-xs text-white/40">
                          {d.pspChannel ? d.pspChannel : 'Deposit'}
                          {d.pspReference ? ` · ${d.pspReference.slice(0, 12)}` : ''}
                        </span>
                        <span className="text-[11px] text-white/30">{formatDateEAT(ts)}</span>
                      </div>
                      {d.mintedAt && d.mintedAt !== d.createdAt && (
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[10px] text-white/20">Minted</span>
                          <span className="text-[10px] text-white/20">{formatDateEAT(d.mintedAt)}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Ramp Section (settlement float + quote console + settlements — the test/ops UI) ── */
interface RampBalance { settlementAddress: string; usdcBalance: string; token: { symbol: string } }
interface RampQuoteResult { quoteId: string; direction: string; usdcAmount: number; tzsAmount: number; feeTzs: number; rateUsdTzs: number; expiresAt: string }
interface RampSettlementRow { settlementId: string; direction: string; status: string; usdcAmount: number; tzsAmount: number; createdAt: string; swapOutTxHash: string | null; pspReference: string | null }

function RampSection() {
  const [balance, setBalance] = useState<RampBalance | null>(null)
  const [balErr, setBalErr] = useState('')
  const [settlements, setSettlements] = useState<RampSettlementRow[]>([])
  const [copied, setCopied] = useState(false)

  const [direction, setDirection] = useState<'offramp' | 'onramp'>('offramp')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<RampQuoteResult | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteErr, setQuoteErr] = useState('')

  const loadSettlements = useCallback(() => {
    fetch('/api/v1/ramp/settlements', { credentials: 'include' })
      .then(async (r) => { if (r.ok) { const j = await r.json(); setSettlements(j.settlements ?? []) } })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/v1/ramp/balance', { credentials: 'include' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) setBalErr(j.error || 'Failed to load'); else setBalance(j) })
      .catch(() => setBalErr('Failed to load'))
    loadSettlements()
  }, [loadSettlements])

  const getQuote = async () => {
    setQuoting(true); setQuoteErr(''); setQuote(null)
    try {
      const body = direction === 'offramp' ? { direction, usdcAmount: Number(amount) } : { direction, tzsAmount: Number(amount) }
      const r = await fetch('/api/v1/ramp/quote', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) setQuoteErr(j.error || 'Quote failed'); else setQuote(j)
    } catch { setQuoteErr('Network error') } finally { setQuoting(false) }
  }

  const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n)
  const statusColor = (s: string) =>
    s === 'completed' ? 'text-emerald-300 bg-emerald-500/10' :
    s === 'failed' || s === 'reverted' ? 'text-red-300 bg-red-500/10' :
    'text-amber-300 bg-amber-500/10'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Ramp</h2>
        <p className="mt-1 text-sm text-white/40">Wallet-less USDC ⇄ mobile-money settlement.</p>
      </div>

      {balErr ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 text-sm text-amber-200">{balErr}</div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-[11px] uppercase tracking-widest text-white/40 mb-3">USDC settlement float</p>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-2xl font-bold tabular-nums">{balance ? `${balance.usdcBalance} USDC` : '—'}</p>
              <p className="mt-1 text-xs text-white/40">Fund this address with USDC (Base) to settle off-ramps.</p>
            </div>
            {balance && (
              <button
                onClick={() => { navigator.clipboard.writeText(balance.settlementAddress); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white/70 hover:bg-white/10"
              >
                {copied ? 'Copied ✓' : `${balance.settlementAddress.slice(0, 10)}…${balance.settlementAddress.slice(-8)}`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quote console */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
        <p className="text-[11px] uppercase tracking-widest text-white/40">Quote console</p>
        <div className="flex flex-wrap gap-3">
          <div className="flex rounded-xl border border-white/10 bg-white/5 p-1 text-xs">
            {(['offramp', 'onramp'] as const).map((d) => (
              <button key={d} onClick={() => { setDirection(d); setQuote(null) }}
                className={`rounded-lg px-3 py-1.5 ${direction === d ? 'bg-white text-black' : 'text-white/60'}`}>
                {d === 'offramp' ? 'Off-ramp (USDC→TZS)' : 'On-ramp (TZS→USDC)'}
              </button>
            ))}
          </div>
          <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={direction === 'offramp' ? 'USDC amount' : 'TZS amount'}
            className="w-44 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none" />
          <button onClick={getQuote} disabled={quoting || !amount}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-40">
            {quoting ? 'Quoting…' : 'Get quote'}
          </button>
        </div>
        {quoteErr && <p className="text-xs text-red-300">{quoteErr}</p>}
        {quote && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { l: 'You send', v: quote.direction === 'offramp' ? `${quote.usdcAmount} USDC` : `${fmt(quote.tzsAmount)} TZS` },
              { l: 'They get', v: quote.direction === 'offramp' ? `${fmt(quote.tzsAmount)} TZS` : `${quote.usdcAmount} USDC` },
              { l: 'Rate', v: `${fmt(quote.rateUsdTzs)} TZS/USDC` },
              { l: 'Fee', v: `${fmt(quote.feeTzs)} TZS` },
            ].map((c) => (
              <div key={c.l} className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-white/40">{c.l}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">{c.v}</p>
              </div>
            ))}
            <p className="col-span-2 text-[11px] text-white/30 sm:col-span-4">Quote {quote.quoteId.slice(0, 8)} · expires {new Date(quote.expiresAt).toLocaleTimeString()} · initiate via the API with this quoteId.</p>
          </div>
        )}
      </div>

      {/* Settlements */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <p className="text-[11px] uppercase tracking-widest text-white/40">Recent settlements</p>
          <button onClick={loadSettlements} className="text-xs text-white/40 hover:text-white/70">Refresh</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-white/40">
                {['Date', 'Direction', 'USDC', 'TZS', 'Status', 'Ref'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {settlements.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-white/30">No settlements yet.</td></tr>}
              {settlements.map((s) => (
                <tr key={s.settlementId} className="hover:bg-white/5">
                  <td className="px-4 py-2.5 text-white/50">{new Date(s.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5 uppercase text-white/60">{s.direction}</td>
                  <td className="px-4 py-2.5 tabular-nums">{s.usdcAmount}</td>
                  <td className="px-4 py-2.5 tabular-nums">{fmt(s.tzsAmount)}</td>
                  <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] ${statusColor(s.status)}`}>{s.status}</span></td>
                  <td className="px-4 py-2.5 font-mono text-white/30">{s.pspReference ?? (s.swapOutTxHash ? s.swapOutTxHash.slice(0, 10) : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ── Capability catalog ("what do you want to build?") ── */
function CatalogSection({ catalog, enabled }: { catalog: CapabilityCatalogItem[]; enabled: string[] }) {
  const [requested, setRequested] = useState<Record<string, 'pending' | 'done' | 'error'>>({})
  const [msg, setMsg] = useState('')

  const request = async (capId: string) => {
    setRequested((p) => ({ ...p, [capId]: 'pending' })); setMsg('')
    try {
      const r = await fetch('/api/v1/partners/capabilities/request', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability: capId }),
      })
      const j = await r.json()
      if (!r.ok) { setRequested((p) => ({ ...p, [capId]: 'error' })); setMsg(j.error || 'Request failed'); return }
      setRequested((p) => ({ ...p, [capId]: 'done' })); setMsg(j.message || 'Request received.')
    } catch { setRequested((p) => ({ ...p, [capId]: 'error' })); setMsg('Network error') }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Capabilities</h2>
        <p className="mt-1 text-sm text-white/40">Compose the capabilities your use case needs — enable only what you use.</p>
      </div>
      {msg && <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">{msg}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        {catalog.map((c) => {
          const on = enabled.includes(c.id)
          const state = requested[c.id]
          return (
            <div key={c.id} className={`rounded-2xl border p-5 ${on ? 'border-emerald-500/20 bg-emerald-500/[0.04]' : 'border-white/10 bg-white/[0.02]'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{c.label}</p>
                    {c.kybRequired && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">KYB</span>}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-white/50">{c.description}</p>
                </div>
                {on ? (
                  <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-medium text-emerald-300">Enabled</span>
                ) : (
                  <button
                    onClick={() => request(c.id)}
                    disabled={state === 'pending' || state === 'done'}
                    className="shrink-0 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
                  >
                    {state === 'done' ? 'Requested ✓' : state === 'pending' ? '…' : 'Request access'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
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
  const [showDisburseModal, setShowDisburseModal] = useState(false)
  const [showCreateWalletModal, setShowCreateWalletModal] = useState(false)
  const [showFundWalletModal, setShowFundWalletModal] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedWalletUser, setSelectedWalletUser] = useState<DashboardUser | null>(null)
  const [frozenOverrides, setFrozenOverrides] = useState<Record<string, boolean>>({})

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

  const { partner, subWallets, transfers, deposits, pendingTransfers, pendingDeposits, recentActivity, stats } = data

  // Merge optimistic freeze overrides into the users array
  const users = data.users.map((u) =>
    u.walletId && frozenOverrides[u.walletId] !== undefined
      ? { ...u, walletFrozen: frozenOverrides[u.walletId] }
      : u
  )

  const handleFreezeToggle = (walletId: string, frozen: boolean) => {
    setFrozenOverrides((prev) => ({ ...prev, [walletId]: frozen }))
    // Reflect in the panel's user too
    setSelectedWalletUser((prev) =>
      prev && prev.walletId === walletId ? { ...prev, walletFrozen: frozen } : prev
    )
  }

  // Nav is capability-driven: account-level items (no `cap`) always show; the
  // rest appear only if the partner has that capability enabled. A legacy
  // partner (full resolved set) sees everything (backward compatible).
  const caps = partner.capabilities ?? []
  const allNav: { key: Section; label: string; icon: ComponentType<{ className?: string }>; cap?: string }[] = [
    { key: 'overview', label: 'Overview', icon: IconDashboard },
    { key: 'wallets', label: 'Wallets', icon: IconWallet, cap: 'wallets' },
    { key: 'transfers', label: 'Transfers', icon: IconActivity, cap: 'transfers' },
    { key: 'deposits', label: 'Collections', icon: IconCoins, cap: 'collections' },
    { key: 'treasury', label: 'Treasury', icon: IconBank, cap: 'treasury' },
    { key: 'ramp', label: 'Ramp', icon: IconCoins, cap: 'ramp' },
    { key: 'catalog', label: 'Capabilities', icon: IconShield },
    { key: 'billing', label: 'Billing', icon: IconCoins },
    { key: 'kyb', label: 'KYB', icon: IconShield },
    { key: 'settings', label: 'Settings', icon: IconShield },
  ]
  const navItems = allNav.filter((i) => !i.cap || caps.includes(i.cap))

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/partners/logout', {
        method: 'POST',
        credentials: 'same-origin',
      })
    } catch {
      // Ignore — cookie will expire on its own.
    }
    router.push('/developers/login')
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
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-white/10 bg-[#0a0a0f] transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Brand */}
        <div className="flex h-16 items-center gap-2 border-b border-white/10 px-5">
          <div className="overflow-hidden rounded-full shrink-0">
            <Image src="/ntzs-logo.png" alt="nTZS" width={28} height={28} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{partner.name}</div>
            <div className="text-[10px] text-white/40">Partner Dashboard</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto space-y-1 p-3">
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
            <IconLink className="h-4 w-4" />
            Docs
            <IconChevronRight className="ml-auto h-3.5 w-3.5 text-white/30" />
          </a>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/50 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <IconShield className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto lg:ml-60">
        <div className="mx-auto max-w-6xl px-6 py-8">
          {/* Welcome header + hero — overview only, always at top */}
          {section === 'overview' && (
            <div className="mb-8 space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Welcome back, {partner.name}</h2>
                <p className="mt-1 text-sm text-white/40">Your financial rails, your rules.</p>
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-blue-900/40 via-[#0a0a1a] to-violet-900/30 p-6">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_50%,rgba(99,102,241,0.12),transparent_60%)]" />
                <div className="relative flex items-center justify-between gap-6">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Image src="/ntzs-logo.png" alt="nTZS" width={22} height={22} className="rounded-full" />
                      <span className="text-xs font-semibold tracking-widest text-white/40 uppercase">nTZS Partner Console</span>
                    </div>
                    <h3 className="text-xl font-bold">Here is what is happening across your platform today.</h3>
                    <p className="mt-2 text-sm text-white/50 max-w-sm">
                      Issue wallets, move TZS, and monitor every transaction — all from one dashboard.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => setShowCreateWalletModal(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90 transition-colors"
                      >
                        <IconPlus className="h-3.5 w-3.5" />
                        Create Wallet
                      </button>
                      <button
                        onClick={() => setShowDisburseModal(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/70 hover:bg-white/10 transition-colors"
                      >
                        <IconSend className="h-3.5 w-3.5" />
                        Disburse TZS
                      </button>
                    </div>
                  </div>
                  <div className="hidden shrink-0 sm:flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-5">
                    <Image src="/ntzs-logo.png" alt="nTZS" width={56} height={56} className="opacity-80" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stats row (always visible) */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
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
            <StatCard
              label="Pending"
              value={String(stats.pendingTransfers + stats.pendingDeposits)}
              sub={`${stats.pendingTransfers} transfers · ${stats.pendingDeposits} deposits`}
            />
          </div>

          {/* Quick Actions */}
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => setShowCreateWalletModal(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10 transition-colors"
            >
              <IconPlus className="h-4 w-4" />
              Create Wallet
            </button>
            <button
              onClick={() => setShowDisburseModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90 transition-colors"
            >
              <IconSend className="h-4 w-4" />
              Disburse TZS
            </button>
            <button
              onClick={() => setShowFundWalletModal(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10 transition-colors"
            >
              <IconArrowDown className="h-4 w-4" />
              Fund Wallet
            </button>
          </div>

          {/* Section content */}
          <div className="mt-8">
            {/* ── Overview ── */}
            {section === 'overview' && (
              <div className="space-y-6">
                {/* Pending alerts */}
                {(pendingTransfers.length > 0 || pendingDeposits.length > 0) && (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-xs font-semibold text-amber-300 uppercase tracking-widest">Needs Attention</span>
                    </div>
                    <div className="space-y-2">
                      {pendingTransfers.slice(0, 3).map((t) => (
                        <div key={t.id} className="flex items-center justify-between text-sm">
                          <span className="text-white/60">
                            Transfer: {t.fromName || t.fromEmail || t.fromUserId.slice(0, 8)} → {t.toName || t.toEmail || t.toUserId.slice(0, 8)}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-white/80">{t.amountTzs.toLocaleString()} TZS</span>
                            <StatusBadge status={t.status} />
                          </div>
                        </div>
                      ))}
                      {pendingDeposits.slice(0, 3).map((d) => (
                        <div key={d.id} className="flex items-center justify-between text-sm">
                          <span className="text-white/60">
                            Deposit: {d.userName || d.userEmail || d.userId.slice(0, 8)}
                            {d.pspChannel && <span className="ml-1 text-white/40">via {d.pspChannel}</span>}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-white/80">{d.amountTzs.toLocaleString()} TZS</span>
                            <StatusBadge status={d.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                    {(pendingTransfers.length > 3 || pendingDeposits.length > 3) && (
                      <p className="mt-2 text-xs text-white/30">and {Math.max(0, pendingTransfers.length - 3) + Math.max(0, pendingDeposits.length - 3)} more...</p>
                    )}
                  </div>
                )}

                <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Recent Activity</h3>

                {/* Unified activity feed */}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  {recentActivity.length === 0 ? (
                    <p className="text-sm text-white/30">No activity yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {recentActivity.map((item) => (
                        <div key={item.id} className="flex items-center justify-between rounded-xl bg-white/[0.02] px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              item.type === 'transfer'
                                ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20'
                                : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                            }`}>
                              {item.type === 'transfer' ? 'Transfer' : 'Deposit'}
                            </span>
                            <div className="min-w-0">
                              {item.type === 'transfer' ? (
                                <div className="text-sm truncate">
                                  {item.fromName || item.fromEmail || '?'} → {item.toName || item.toEmail || '?'}
                                </div>
                              ) : (
                                <div className="text-sm truncate">{item.userName || item.userEmail || '?'}</div>
                              )}
                              <div className="text-xs text-white/40">
                                {formatDateEAT(item.createdAt)}
                                {item.updatedAt !== item.createdAt && (
                                  <span className="ml-2 text-white/25">updated {formatDateEAT(item.updatedAt)}</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-sm font-medium font-mono">{item.amountTzs.toLocaleString()} TZS</span>
                            <StatusBadge status={item.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 flex gap-4">
                    <button onClick={() => setSection('transfers')} className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                      All transfers <IconChevronRight className="h-3 w-3" />
                    </button>
                    <button onClick={() => setSection('deposits')} className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                      All deposits <IconChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Wallets ── */}
            {section === 'wallets' && (
              <div>
                <h2 className="text-lg font-semibold mb-4">Wallets</h2>
                <div className="overflow-x-auto rounded-2xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Email</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">External ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Wallet Address</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Label</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-white/40">Balance</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-white/40">Txns</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Last Transfer</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Joined (EAT)</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-white/40">Actions</th>
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
                          <td className="px-4 py-3" />
                          <td className="px-4 py-3" />
                          <td className="px-4 py-3" />
                          <td className="px-4 py-3" />
                          <td className="px-4 py-3" />
                        </tr>
                      )}
                      {/* Sub-wallet rows */}
                      {subWallets.map((sw) => (
                        <tr key={sw.id} className="border-b border-white/5 bg-violet-500/[0.02] hover:bg-violet-500/[0.04]">
                          <td className="px-4 py-3 font-medium text-white/80">{sw.label}</td>
                          <td className="px-4 py-3 text-white/40">—</td>
                          <td className="px-4 py-3 font-mono text-xs text-white/40">—</td>
                          <td className="px-4 py-3 font-mono text-xs text-white/50">
                            {sw.address.slice(0, 6)}...{sw.address.slice(-4)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                              Sub-wallet
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-white/80">
                            {sw.balanceTzs.toLocaleString()} TZS
                          </td>
                          <td className="px-4 py-3" />
                          <td className="px-4 py-3" />
                          <td className="px-4 py-3 text-xs text-white/30">{formatDateEAT(sw.createdAt)}</td>
                          <td className="px-4 py-3" />
                        </tr>
                      ))}
                      {/* User wallets */}
                      {users.length === 0 && !partner.treasuryWalletAddress && subWallets.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="px-4 py-8 text-center text-white/40">
                            No wallets yet.
                          </td>
                        </tr>
                      ) : (
                        users.map((u) => (
                          <tr
                            key={u.id}
                            onClick={() => setSelectedWalletUser(u)}
                            className={`cursor-pointer border-b border-white/5 transition-colors hover:bg-white/[0.04] ${u.walletFrozen ? 'bg-red-500/[0.03]' : ''}`}
                          >
                            <td className="px-4 py-3 text-white/80">{u.name || '—'}</td>
                            <td className="px-4 py-3 text-white/60 text-xs">{u.email}</td>
                            <td className="px-4 py-3 font-mono text-xs text-white/50">{u.externalId}</td>
                            <td className="px-4 py-3 font-mono text-xs text-white/50">
                              {u.walletAddress
                                ? `${u.walletAddress.slice(0, 6)}...${u.walletAddress.slice(-4)}`
                                : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-300">
                                  User
                                </span>
                                {u.walletFrozen && (
                                  <span className="inline-flex rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-300">
                                    Frozen
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-white/80">
                              <div>{u.balanceTzs.toLocaleString()} TZS</div>
                              {u.balanceUsdc > 0 && (
                                <div className="text-[11px] text-blue-300/70">{u.balanceUsdc.toFixed(2)} USDC</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-white/50">
                              <div>{u.totalTransfers}</div>
                              {u.totalTransfers > 0 && (
                                <div className="text-[10px] text-white/30">{u.totalSent} out · {u.totalReceived} in</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-white/40">
                              {u.lastTransferAt ? formatDateEAT(u.lastTransferAt) : '—'}
                            </td>
                            <td className="px-4 py-3 text-xs text-white/40">
                              <div>{formatDateEAT(u.createdAt)}</div>
                              {u.walletCreatedAt && u.walletCreatedAt !== u.createdAt && (
                                <div className="text-[10px] text-white/25">wallet {formatDateEAT(u.walletCreatedAt)}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {u.walletId && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedWalletUser(u)
                                  }}
                                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                                >
                                  Manage
                                </button>
                              )}
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
                <div className="overflow-x-auto rounded-2xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">From</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">To</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-white/40">Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Tx Hash</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Submitted (EAT)</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Last Updated (EAT)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transfers.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-white/40">
                            No transfers yet.
                          </td>
                        </tr>
                      ) : (
                        transfers.map((t) => (
                          <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-4 py-3 text-white/70 text-xs">
                              <div>{t.fromName || t.fromEmail || t.fromUserId.slice(0, 8)}</div>
                              {t.fromName && t.fromEmail && <div className="text-[10px] text-white/30">{t.fromEmail}</div>}
                            </td>
                            <td className="px-4 py-3 text-white/70 text-xs">
                              <div>{t.toName || t.toEmail || t.toUserId.slice(0, 8)}</div>
                              {t.toName && t.toEmail && <div className="text-[10px] text-white/30">{t.toEmail}</div>}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-white/80">
                              {t.amountTzs.toLocaleString()} TZS
                            </td>
                            <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                            <td className="px-4 py-3 font-mono text-xs text-white/40">
                              {t.txHash
                                ? <a href={`https://basescan.org/tx/${t.txHash}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">{t.txHash.slice(0, 10)}...</a>
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-xs text-white/40">{formatDateEAT(t.createdAt)}</td>
                            <td className="px-4 py-3 text-xs text-white/40">{formatDateEAT(t.updatedAt)}</td>
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
                <div className="overflow-x-auto rounded-2xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">User</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Destination</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Payer</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-white/40">Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Reference</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Submitted (EAT)</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Last Updated (EAT)</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Confirmed (EAT)</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-white/40">Minted (EAT)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deposits.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="px-4 py-8 text-center text-white/40">
                            No deposits yet.
                          </td>
                        </tr>
                      ) : (
                        deposits.map((d) => {
                          const isTreasury = d.destWalletAddress != null &&
                            partner.treasuryWalletAddress != null &&
                            d.destWalletAddress.toLowerCase() === partner.treasuryWalletAddress.toLowerCase()
                          return (
                          <tr key={d.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-4 py-3 font-mono text-xs text-white/50">{d.id.slice(0, 8)}...</td>
                            <td className="px-4 py-3 text-xs text-white/70">
                              <div>{d.userName || d.userEmail || d.userId.slice(0, 8)}</div>
                              {d.userName && d.userEmail && <div className="text-[10px] text-white/30">{d.userEmail}</div>}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {d.destWalletAddress ? (
                                <div>
                                  {isTreasury && (
                                    <span className="inline-block mb-0.5 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-widest bg-violet-500/20 text-violet-300">Treasury</span>
                                  )}
                                  <div className="font-mono text-[10px] text-white/40">{d.destWalletAddress.slice(0, 6)}…{d.destWalletAddress.slice(-4)}</div>
                                </div>
                              ) : <span className="text-white/20">—</span>}
                            </td>
                            <td className="px-4 py-3 text-xs text-white/50">
                              <div>{d.payerName || '—'}</div>
                              {d.buyerPhone && <div className="text-[10px] text-white/30">{d.buyerPhone}</div>}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-white/80">
                              {d.amountTzs.toLocaleString()} TZS
                            </td>
                            <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                            <td className="px-4 py-3 font-mono text-xs text-white/40">{d.pspReference || '—'}</td>
                            <td className="px-4 py-3 text-xs text-white/40">{formatDateEAT(d.createdAt)}</td>
                            <td className="px-4 py-3 text-xs text-white/40">{formatDateEAT(d.updatedAt)}</td>
                            <td className="px-4 py-3 text-xs text-white/40">{d.fiatConfirmedAt ? formatDateEAT(d.fiatConfirmedAt) : '—'}</td>
                            <td className="px-4 py-3 text-xs">{d.mintedAt ? <span className="text-emerald-400">{formatDateEAT(d.mintedAt)}</span> : <span className="text-white/30">—</span>}</td>
                          </tr>
                          )
                        })
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

            {/* ── Ramp ── */}
            {section === 'ramp' && (
              <RampSection />
            )}

            {/* ── Capability catalog ── */}
            {section === 'catalog' && (
              <CatalogSection catalog={data.capabilityCatalog} enabled={partner.capabilities} />
            )}

            {/* ── Billing ── */}
            {section === 'billing' && (
              <BillingSection partner={partner} />
            )}

            {/* ── KYB ── */}
            {section === 'kyb' && (
              <KybSection partner={partner} />
            )}

            {/* ── Settings ── */}
            {section === 'settings' && (
              <SettingsSection partner={partner} onRefresh={fetchDashboard} />
            )}
          </div>
        </div>
      </main>

      {/* Disburse Modal */}
      {showDisburseModal && (
        <DisburseModal
          users={users}
          subWallets={subWallets}
          partner={partner}
          onClose={() => setShowDisburseModal(false)}
          onSuccess={fetchDashboard}
        />
      )}

      {/* Create Wallet Modal */}
      {showCreateWalletModal && (
        <CreateWalletModal
          onClose={() => setShowCreateWalletModal(false)}
          onSuccess={fetchDashboard}
        />
      )}

      {/* Fund Wallet Modal */}
      {showFundWalletModal && (
        <FundWalletModal
          partner={partner}
          onClose={() => setShowFundWalletModal(false)}
          onSuccess={fetchDashboard}
        />
      )}

      {/* Wallet Detail Panel */}
      {selectedWalletUser && (
        <WalletDetailPanel
          user={selectedWalletUser}
          transfers={transfers}
          deposits={deposits}
          onClose={() => setSelectedWalletUser(null)}
          onFreezeToggle={handleFreezeToggle}
        />
      )}
    </div>
  )
}
