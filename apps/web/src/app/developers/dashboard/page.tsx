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
  createdAt: string
}

interface DashboardUser {
  id: string
  externalId: string
  email: string
  name: string | null
  phone: string | null
  walletId: string | null
  walletAddress: string | null
  walletFrozen: boolean
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

interface DashboardSubWallet {
  id: string
  label: string
  address: string
  walletIndex: number
  balanceTzs: number
  createdAt: string
}

interface DashboardData {
  partner: PartnerInfo
  users: DashboardUser[]
  subWallets: DashboardSubWallet[]
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
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
        active ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/70'
      }`}
    >
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

/* ── Wallet Detail Panel ── */
function WalletDetailPanel({
  user,
  transfers,
  onClose,
  onFreezeToggle,
}: {
  user: DashboardUser
  transfers: DashboardTransfer[]
  onClose: () => void
  onFreezeToggle: (walletId: string, frozen: boolean) => void
}) {
  const [toggling, setToggling] = useState(false)
  const [err, setErr] = useState('')

  const userTransfers = transfers.filter(
    (t) => t.fromUserId === user.id || t.toUserId === user.id
  )

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
              { label: 'Balance', value: `${user.balanceTzs.toLocaleString()} TZS` },
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
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/30">
              Transaction History
            </h4>
            {userTransfers.length === 0 ? (
              <p className="text-sm text-white/30">No transactions yet.</p>
            ) : (
              <div className="space-y-2">
                {userTransfers.map((t) => {
                  const isSender = t.fromUserId === user.id
                  return (
                    <div key={t.id} className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-semibold uppercase ${isSender ? 'text-red-400' : 'text-emerald-400'}`}>
                            {isSender ? '↑ Sent' : '↓ Received'}
                          </span>
                          <StatusBadge status={t.status} />
                        </div>
                        <span className={`text-sm font-mono font-medium ${isSender ? 'text-red-300' : 'text-emerald-300'}`}>
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
                        <div className="mt-1 font-mono text-[10px] text-white/20 truncate">{t.txHash}</div>
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

  const { partner, subWallets, transfers, deposits, stats } = data

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

  const navItems: { key: Section; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { key: 'overview', label: 'Overview', icon: IconDashboard },
    { key: 'wallets', label: 'Wallets', icon: IconWallet },
    { key: 'transfers', label: 'Transfers', icon: IconActivity },
    { key: 'deposits', label: 'Deposits', icon: IconCoins },
    { key: 'treasury', label: 'Treasury', icon: IconBank },
    { key: 'settings', label: 'Settings', icon: IconShield },
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
                <p className="mt-1 text-sm text-white/40">Here is what is happening across your platform today.</p>
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-blue-900/40 via-[#0a0a1a] to-violet-900/30 p-6">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_50%,rgba(99,102,241,0.12),transparent_60%)]" />
                <div className="relative flex items-center justify-between gap-6">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Image src="/ntzs-logo.png" alt="nTZS" width={22} height={22} className="rounded-full" />
                      <span className="text-xs font-semibold tracking-widest text-white/40 uppercase">nTZS Partner Console</span>
                    </div>
                    <h3 className="text-xl font-bold">Your financial rails, your rules.</h3>
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
                <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Recent Activity</h3>

                {/* Recent transfers */}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-white/60">Recent Transfers</h3>
                    <button onClick={() => setSection('transfers')} className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                      View all
                      <IconChevronRight className="h-3 w-3" />
                    </button>
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
                    <button onClick={() => setSection('deposits')} className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                      View all
                      <IconChevronRight className="h-3 w-3" />
                    </button>
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
                        </tr>
                      ))}
                      {/* User wallets */}
                      {users.length === 0 && !partner.treasuryWalletAddress && subWallets.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-white/40">
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
                            <td className="px-4 py-3 text-white/60">{u.email}</td>
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
                              {u.balanceTzs.toLocaleString()} TZS
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
          onClose={() => setSelectedWalletUser(null)}
          onFreezeToggle={handleFreezeToggle}
        />
      )}
    </div>
  )
}
