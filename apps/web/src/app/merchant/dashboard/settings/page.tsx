'use client';

import { useState, useEffect } from 'react';
import { useMerchant } from '../layout';
import { Copy, Check, User, ArrowDownUp, Shield, QrCode, Lock, Eye, EyeOff, Sparkles } from 'lucide-react';
import { QrCustomizer } from './QrCustomizer';
import { useAiAssistant } from '../_components/AiAssistant';

type Tab = 'profile' | 'settlement' | 'security' | 'qr' | 'ai';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'profile',    label: 'Profile',    icon: User },
  { id: 'settlement', label: 'Settlement', icon: ArrowDownUp },
  { id: 'security',   label: 'Security',   icon: Shield },
  { id: 'qr',         label: 'QR Code',    icon: QrCode },
  { id: 'ai',         label: 'AI Agent',   icon: Sparkles },
];

function passwordStrength(p: string): { level: 0 | 1 | 2 | 3; label: string; color: string } {
  if (!p) return { level: 0, label: '', color: '' };
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[A-Z]/.test(p) && /[0-9!@#$%^&*]/.test(p)) score++;
  return ([
    { level: 0, label: '', color: '' },
    { level: 1, label: 'Weak',   color: 'bg-rose-500' },
    { level: 2, label: 'Good',   color: 'bg-amber-400' },
    { level: 3, label: 'Strong', color: 'bg-emerald-400' },
  ] as const)[score];
}

export default function SettingsPage() {
  const { merchant, refresh } = useMerchant();
  const [tab, setTab] = useState<Tab>('profile');

  // Profile
  const [businessName, setBusinessName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [copied, setCopied] = useState(false);

  // Settlement
  const [settlePct, setSettlePct] = useState(0);
  const [settlementPhone, setSettlementPhone] = useState('');
  const [settleSaving, setSettleSaving] = useState(false);
  const [settleSaved, setSettleSaved] = useState(false);
  const [settleError, setSettleError] = useState('');

  // Financing
  type FinancingStatus = {
    isUnderLender: boolean
    lenderName: string | null
    lenderSplitPct: number
    lenderControlsSettlement: boolean
    withdrawalLimitTzs: number
    settlePct: number
    loan: { loanStatus: string | null; principalTzs: number | null; totalOwedTzs: number | null; repaidTzs: number | null; interestRatePct: number | null } | null
    pendingInvite: { id: string; proposedSplitPct: number | null; message: string | null; enterpriseName: string; createdAt: string } | null
    pendingApplication: { id: string; createdAt: string } | null
  }
  const [financing, setFinancing] = useState<FinancingStatus | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')
  const [inviteResponding, setInviteResponding] = useState(false)
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawPhone, setWithdrawPhone] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const [withdrawSuccess, setWithdrawSuccess] = useState('')

  // Security
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSaved, setPwSaved] = useState(false);
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    if (merchant) {
      setBusinessName(merchant.businessName ?? '');
      setSettlePct(merchant.settlePct);
      setSettlementPhone(merchant.settlementPhone ?? '');
    }
  }, [merchant]);

  useEffect(() => {
    if (tab === 'settlement') {
      fetch('/merchant/api/merchant/financing/status')
        .then(r => r.json())
        .then(setFinancing)
        .catch(() => {})
    }
  }, [tab]);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileError('');
    setSaving(true);
    try {
      const res = await fetch('/merchant/api/merchant/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleSettlementSave(e: React.FormEvent) {
    e.preventDefault();
    setSettleError('');
    setSettleSaving(true);
    try {
      const res = await fetch('/merchant/api/merchant/settlement', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settlePct, settlementPhone }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await refresh();
      setSettleSaved(true);
      setTimeout(() => setSettleSaved(false), 3000);
    } catch (err) {
      setSettleError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSettleSaving(false);
    }
  }

  async function handleApply() {
    setApplying(true); setApplyError('');
    try {
      const res = await fetch('/merchant/api/merchant/financing/apply', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setApplyError(data.error ?? 'Failed to apply'); return; }
      const updated = await fetch('/merchant/api/merchant/financing/status').then(r => r.json());
      setFinancing(updated);
    } catch { setApplyError('Network error'); }
    finally { setApplying(false); }
  }

  async function handleCancelApplication() {
    await fetch('/merchant/api/merchant/financing/apply', { method: 'DELETE' });
    const updated = await fetch('/merchant/api/merchant/financing/status').then(r => r.json());
    setFinancing(updated);
  }

  async function handleInviteRespond(inviteId: string, action: 'accept' | 'reject') {
    setInviteResponding(true);
    try {
      await fetch(`/merchant/api/merchant/financing/invites/${inviteId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const updated = await fetch('/merchant/api/merchant/financing/status').then(r => r.json());
      setFinancing(updated);
    } finally { setInviteResponding(false); }
  }

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawError(''); setWithdrawSuccess('');
    setWithdrawing(true);
    try {
      const res = await fetch('/merchant/api/merchant/financing/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountTzs: Number(withdrawAmount), phone: withdrawPhone }),
      });
      const data = await res.json();
      if (!res.ok) { setWithdrawError(data.error ?? 'Withdrawal failed'); return; }
      setWithdrawSuccess(`TZS ${Number(withdrawAmount).toLocaleString()} withdrawal requested. You'll receive it shortly.`);
      setWithdrawAmount(''); setWithdrawPhone('');
    } catch { setWithdrawError('Network error'); }
    finally { setWithdrawing(false); }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    if (newPassword !== confirmPassword) { setPwError('Passwords do not match'); return; }
    if (newPassword.length < 8) { setPwError('Password must be at least 8 characters'); return; }
    setPwSaving(true);
    try {
      const res = await fetch('/merchant/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword, currentPassword: currentPassword || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwSaved(true);
      setTimeout(() => setPwSaved(false), 3000);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setPwSaving(false);
    }
  }

  if (!merchant) return null;

  const initial = (merchant.businessName || merchant.handle)[0].toUpperCase();
  const displayName = merchant.businessName || `@${merchant.handle}`;
  const grossPreview = Math.trunc(10000 * settlePct / 100);
  const netPreview = Math.trunc((grossPreview - 1500) * 0.995);
  const pwStrength = passwordStrength(newPassword);
  const payUrl = typeof window !== 'undefined' ? `${window.location.origin}/m/${merchant.handle}` : '';

  return (
    <div className="p-5 lg:p-7 max-w-2xl mx-auto font-mono">
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .s-anim-1 { animation: fadeUp 0.4s ease-out 0.05s both; }
        .s-anim-2 { animation: fadeUp 0.4s ease-out 0.12s both; }
        .s-anim-3 { animation: fadeUp 0.4s ease-out 0.20s both; }
        .tab-content { animation: fadeIn 0.25s ease-out both; }
      `}</style>

      {/* Breadcrumb */}
      <div className="s-anim-1 flex items-center gap-3 mb-6">
        <div className="w-4 h-px bg-emerald-400/60" />
        <span className="text-[10px] tracking-widest text-white/40 uppercase">Dashboard / Settings</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      {/* Profile header */}
      <div className="s-anim-2 flex items-center gap-4 mb-7">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center border border-emerald-500/30 bg-emerald-500/10 text-xl font-bold text-emerald-400">
          {initial}
        </div>
        <div className="min-w-0">
          <p className="text-base font-bold text-white tracking-wide truncate">{displayName}</p>
          <p className="text-xs text-white/40 mt-0.5">@{merchant.handle}</p>
          <p className="text-[10px] text-white/25 tracking-wide mt-0.5 truncate">{merchant.email}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] tracking-widest text-emerald-400/70 uppercase">Active</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="s-anim-3 flex border-b border-white/10 mb-6">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-[10px] tracking-widest uppercase transition-colors border-b-2 -mb-px ${
              tab === id
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-white/30 hover:text-white/55'
            }`}
          >
            <Icon size={11} />
            {label}
          </button>
        ))}
      </div>

      {/* ── PROFILE TAB ── */}
      {tab === 'profile' && (
        <form key="profile" onSubmit={handleProfileSave} className="tab-content space-y-5">
          <div className="space-y-4">

            <div>
              <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
                Business Name
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="My Business"
                className="w-full border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-emerald-500/50 focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
                Store Handle
              </label>
              <div className="flex items-center gap-2 border border-white/10 bg-white/[0.03] px-4 py-3">
                <span className="text-white/40 text-sm">@</span>
                <span className="text-sm text-white/60 flex-1">{merchant.handle}</span>
                <span className="text-[10px] text-white/25 tracking-widest uppercase">Permanent</span>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
                Wallet Address
              </label>
              <div className="flex items-center gap-2 border border-white/10 bg-white/[0.03] px-4 py-3">
                <span className="flex-1 truncate text-xs text-white/45 font-mono">{merchant.walletAddress}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(merchant.walletAddress);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="shrink-0 text-white/25 hover:text-white/60 transition-colors ml-2"
                >
                  {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
                Email
              </label>
              <div className="flex items-center gap-2 border border-white/10 bg-white/[0.03] px-4 py-3">
                <span className="text-sm text-white/45">{merchant.email}</span>
              </div>
            </div>
          </div>

          {profileError && (
            <p className="border border-rose-500/20 bg-rose-500/[0.04] px-4 py-2.5 text-xs text-rose-300">{profileError}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full border border-emerald-500/40 bg-emerald-500/10 py-3 text-[10px] font-semibold tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Profile'}
          </button>
        </form>
      )}

      {/* ── SETTLEMENT TAB ── */}
      {tab === 'settlement' && (
        <div key="settlement" className="tab-content space-y-6">

          {/* Pending invite banner */}
          {financing?.pendingInvite && !financing.lenderControlsSettlement && (
            <div className="border border-amber-500/30 bg-amber-500/[0.06] p-4 space-y-3">
              <p className="text-[10px] tracking-widest text-amber-400/70 uppercase">Financing Invite</p>
              <p className="text-sm text-white font-medium">
                {financing.pendingInvite.enterpriseName} has invited you to their financing programme
              </p>
              {financing.pendingInvite.proposedSplitPct != null && (
                <p className="text-xs text-white/50">
                  Proposed repayment split: <span className="text-amber-400">{financing.pendingInvite.proposedSplitPct}%</span> of each collection
                </p>
              )}
              {financing.pendingInvite.message && (
                <p className="text-xs text-white/40 italic">&ldquo;{financing.pendingInvite.message}&rdquo;</p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={inviteResponding}
                  onClick={() => handleInviteRespond(financing.pendingInvite!.id, 'accept')}
                  className="px-4 py-2 text-[10px] tracking-widest uppercase border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={inviteResponding}
                  onClick={() => handleInviteRespond(financing.pendingInvite!.id, 'reject')}
                  className="px-4 py-2 text-[10px] tracking-widest uppercase border border-white/10 text-white/40 hover:text-white/60 disabled:opacity-40 transition-colors"
                >
                  Decline
                </button>
              </div>
            </div>
          )}

          {/* STATE C: Under lender control */}
          {financing?.lenderControlsSettlement ? (
            <div className="space-y-6">
              {/* Lock notice */}
              <div className="flex items-center gap-3 border border-indigo-500/30 bg-indigo-500/[0.06] px-4 py-3">
                <Lock size={14} className="text-indigo-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-indigo-400">Settlement managed by {financing.lenderName ?? 'your lender'}</p>
                  <p className="text-[10px] text-white/35 mt-0.5">Your repayment split is set by your lender as part of the financing agreement.</p>
                </div>
              </div>

              {/* 3-way split preview */}
              <div className="border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <p className="text-[10px] tracking-widest text-white/35 uppercase mb-2">Payment split per collection</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: financing.lenderName ?? 'Lender', pct: financing.lenderSplitPct, color: 'text-indigo-400' },
                    { label: 'You (settlement)', pct: financing.settlePct, color: 'text-emerald-400' },
                    { label: 'NEDApay', pct: Math.max(0, 100 - financing.lenderSplitPct - financing.settlePct), color: 'text-white/40' },
                  ].map(s => (
                    <div key={s.label} className="border border-white/5 bg-black p-3 text-center">
                      <p className="text-[9px] text-white/35 mb-1 leading-tight">{s.label}</p>
                      <p className={`text-lg font-bold tabular-nums ${s.color}`}>{s.pct}%</p>
                    </div>
                  ))}
                </div>
                {financing.loan && financing.loan.totalOwedTzs && (
                  <div className="space-y-1.5 pt-3 border-t border-white/[0.07]">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-white/40">Loan principal</span>
                      <span className="text-white/60 tabular-nums">TZS {financing.loan.principalTzs?.toLocaleString() ?? '—'}</span>
                    </div>
                    {(financing.loan.interestRatePct ?? 0) > 0 && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-white/40">Interest ({financing.loan.interestRatePct}% flat)</span>
                        <span className="text-white/60 tabular-nums">TZS {((financing.loan.totalOwedTzs ?? 0) - (financing.loan.principalTzs ?? 0)).toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[10px] pt-1 border-t border-white/[0.07]">
                      <span className="text-white/50 font-semibold uppercase tracking-wide">Repaid</span>
                      <span className="text-emerald-400 font-semibold tabular-nums">
                        TZS {financing.loan.repaidTzs?.toLocaleString() ?? '0'} / {financing.loan.totalOwedTzs.toLocaleString()}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="h-1.5 w-full bg-white/10 overflow-hidden mt-1">
                      <div
                        className="h-full bg-emerald-500 transition-all"
                        style={{ width: `${Math.min(100, Math.round(((financing.loan.repaidTzs ?? 0) / financing.loan.totalOwedTzs) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Withdrawal panel */}
              {financing.withdrawalLimitTzs > 0 && (
                <div className="border border-white/10 bg-white/[0.02] p-4 space-y-4">
                  <div>
                    <p className="text-[10px] tracking-widest text-white/50 uppercase mb-1">Withdraw Funds</p>
                    <p className="text-[10px] text-white/30">
                      Cap per request: <span className="text-indigo-400">TZS {financing.withdrawalLimitTzs.toLocaleString()}</span>
                    </p>
                    <p className="text-[10px] text-white/25 mt-1 leading-relaxed">
                      Withdrawals are funded from your lender&apos;s treasury. If a draw is declined for insufficient funds, ask your lender to top up.
                    </p>
                  </div>
                  <form onSubmit={handleWithdraw} className="space-y-3">
                    <div>
                      <label className="mb-1.5 block text-[10px] text-white/40 uppercase tracking-wider">Amount (TZS)</label>
                      <input
                        type="number"
                        min={1}
                        max={financing.withdrawalLimitTzs}
                        value={withdrawAmount}
                        onChange={e => setWithdrawAmount(e.target.value)}
                        placeholder={`Max ${financing.withdrawalLimitTzs.toLocaleString()}`}
                        className="w-full border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-indigo-500/50 focus:outline-none transition-colors"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[10px] text-white/40 uppercase tracking-wider">Mobile Money Number</label>
                      <input
                        type="tel"
                        value={withdrawPhone}
                        onChange={e => setWithdrawPhone(e.target.value)}
                        placeholder="07XX XXX XXX"
                        className="w-full border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-indigo-500/50 focus:outline-none transition-colors"
                      />
                    </div>
                    {withdrawError && <p className="text-xs text-rose-400">{withdrawError}</p>}
                    {withdrawSuccess && <p className="text-xs text-emerald-400">{withdrawSuccess}</p>}
                    <button
                      type="submit"
                      disabled={withdrawing || !withdrawAmount || !withdrawPhone}
                      className="w-full border border-indigo-500/40 bg-indigo-500/10 py-3 text-[10px] font-semibold tracking-widest text-indigo-400 uppercase hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {withdrawing ? 'Processing…' : 'Request Withdrawal'}
                    </button>
                  </form>
                </div>
              )}
            </div>

          ) : financing?.pendingApplication ? (
            /* STATE B: Application pending */
            <div className="space-y-4">
              <div className="flex items-center gap-3 border border-white/15 bg-white/[0.03] px-4 py-3">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-white">Application pending</p>
                  <p className="text-[10px] text-white/35 mt-0.5">Ramani is reviewing your profile. Settlement controls are locked until resolved.</p>
                </div>
              </div>

              {/* Disabled slider */}
              <div className="opacity-40 pointer-events-none select-none">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[10px] font-medium tracking-widest text-white/50 uppercase">Auto-Settlement Rate</label>
                  <span className="text-2xl font-bold text-emerald-400 tabular-nums">{merchant.settlePct}%</span>
                </div>
                <input type="range" min={0} max={100} step={5} value={merchant.settlePct} readOnly className="w-full accent-emerald-500" />
              </div>

              <button
                type="button"
                onClick={handleCancelApplication}
                className="w-full border border-white/10 py-3 text-[10px] tracking-widest text-white/30 uppercase hover:text-white/50 transition-colors"
              >
                Cancel Application
              </button>
            </div>

          ) : (
            /* STATE A: No lender — normal settlement form + Apply CTA */
            <form onSubmit={handleSettlementSave} className="space-y-6">

              {/* Slider */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[10px] font-medium tracking-widest text-white/50 uppercase">
                    Auto-Settlement Rate
                  </label>
                  <span className="text-2xl font-bold text-emerald-400 tabular-nums">{settlePct}%</span>
                </div>
                <div className="grid grid-cols-5 gap-1.5 mb-3">
                  {[0, 25, 50, 75, 100].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setSettlePct(v)}
                      className={`py-1.5 text-[10px] tracking-wide border transition-colors ${
                        settlePct === v
                          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                          : 'border-white/10 text-white/30 hover:border-white/20 hover:text-white/50'
                      }`}
                    >
                      {v === 0 ? 'Off' : `${v}%`}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={settlePct}
                  onChange={(e) => setSettlePct(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>

              {settlePct > 0 && (
                <div className="border border-white/10 bg-white/[0.02] p-4 space-y-3">
                  <p className="text-[10px] tracking-widest text-white/35 uppercase mb-3">For a 10,000 TZS payment</p>
                  <div className="h-2 w-full bg-white/10 overflow-hidden flex">
                    <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${settlePct}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-white/35">
                    <span className="text-emerald-400">{settlePct}% → Mobile Money</span>
                    <span>{100 - settlePct}% stays in wallet</span>
                  </div>
                  <div className="space-y-2 pt-1 border-t border-white/[0.07]">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-white/40">Gross settlement</span>
                      <span className="text-xs text-white/60 tabular-nums">{grossPreview.toLocaleString()} TZS</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-white/40">Transfer fee</span>
                      <span className="text-xs text-rose-400/70 tabular-nums">− 1,500 TZS</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-white/40">Platform fee (0.5%)</span>
                      <span className="text-xs text-rose-400/70 tabular-nums">− {Math.trunc((grossPreview - 1500) * 0.005).toLocaleString()} TZS</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/[0.07] pt-2">
                      <span className="text-[10px] font-semibold text-white/60 uppercase tracking-wide">You receive</span>
                      <span className={`text-sm font-bold tabular-nums ${netPreview > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {netPreview > 0 ? `${netPreview.toLocaleString()} TZS` : 'Too low to cover fees'}
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-white/25 leading-relaxed pt-1">
                    Minimum payout threshold: 5,000 TZS. Smaller collections accumulate until the threshold is reached.
                  </p>
                </div>
              )}

              {settlePct > 0 && (
                <div>
                  <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
                    Mobile Money Number
                  </label>
                  <input
                    type="tel"
                    placeholder="07XX XXX XXX"
                    value={settlementPhone}
                    onChange={(e) => setSettlementPhone(e.target.value)}
                    className="w-full border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-emerald-500/50 focus:outline-none transition-colors"
                  />
                </div>
              )}

              {settleError && (
                <p className="border border-rose-500/20 bg-rose-500/[0.04] px-4 py-2.5 text-xs text-rose-300">{settleError}</p>
              )}

              <button
                type="submit"
                disabled={settleSaving}
                className="w-full border border-emerald-500/40 bg-emerald-500/10 py-3 text-[10px] font-semibold tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {settleSaving ? 'Saving...' : settleSaved ? '✓ Saved' : 'Save Settlement'}
              </button>

              {/* Apply for working capital CTA */}
              <div className="border border-white/[0.06] bg-white/[0.01] p-4 space-y-3">
                <p className="text-[10px] tracking-widest text-white/30 uppercase">Working Capital</p>
                <p className="text-xs text-white/50">Apply for revenue-based financing. Ramani deploys capital to your wallet and takes a % of each collection as repayment.</p>
                {applyError && <p className="text-xs text-rose-400">{applyError}</p>}
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={applying}
                  className="w-full border border-indigo-500/30 bg-indigo-500/[0.07] py-2.5 text-[10px] font-semibold tracking-widest text-indigo-400 uppercase hover:bg-indigo-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {applying ? 'Applying…' : 'Apply for Working Capital'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ── SECURITY TAB ── */}
      {tab === 'security' && (
        <form key="security" onSubmit={handlePasswordChange} className="tab-content space-y-5">

          {/* Status badge */}
          <div className={`flex items-center gap-3 border px-4 py-3 ${
            merchant.hasPassword
              ? 'border-emerald-500/20 bg-emerald-500/[0.05]'
              : 'border-amber-500/20 bg-amber-500/[0.05]'
          }`}>
            <Lock size={14} className={merchant.hasPassword ? 'text-emerald-400' : 'text-amber-400'} />
            <div>
              <p className={`text-xs font-semibold ${merchant.hasPassword ? 'text-emerald-400' : 'text-amber-400'}`}>
                {merchant.hasPassword ? 'Password set' : 'No password set'}
              </p>
              <p className="text-[10px] text-white/35 mt-0.5">
                {merchant.hasPassword
                  ? 'You can sign in with your password instead of an email code.'
                  : 'Set a password to sign in faster — no email code needed.'}
              </p>
            </div>
          </div>

          {merchant.hasPassword && (
            <div>
              <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
                Current Password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/20 focus:border-emerald-500/50 focus:outline-none transition-colors"
              />
            </div>
          )}

          <div>
            <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
              {merchant.hasPassword ? 'New Password' : 'Password'}
            </label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="w-full border border-white/15 bg-black px-4 py-3 pr-10 text-sm text-white placeholder:text-white/20 focus:border-emerald-500/50 focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowNew(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/50 transition-colors"
              >
                {showNew ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            {/* Strength meter */}
            {newPassword && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex gap-1 flex-1">
                  {[1, 2, 3].map((level) => (
                    <div
                      key={level}
                      className={`h-1 flex-1 transition-all duration-300 ${
                        pwStrength.level >= level ? pwStrength.color : 'bg-white/10'
                      }`}
                    />
                  ))}
                </div>
                {pwStrength.label && (
                  <span className={`text-[10px] tracking-wide ${
                    pwStrength.level === 1 ? 'text-rose-400' :
                    pwStrength.level === 2 ? 'text-amber-400' : 'text-emerald-400'
                  }`}>{pwStrength.label}</span>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
              Confirm Password
            </label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                className={`w-full border bg-black px-4 py-3 pr-10 text-sm text-white placeholder:text-white/20 focus:outline-none transition-colors ${
                  confirmPassword && confirmPassword !== newPassword
                    ? 'border-rose-500/40 focus:border-rose-500/60'
                    : confirmPassword && confirmPassword === newPassword
                    ? 'border-emerald-500/40 focus:border-emerald-500/60'
                    : 'border-white/15 focus:border-emerald-500/50'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/50 transition-colors"
              >
                {showConfirm ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            {confirmPassword && confirmPassword !== newPassword && (
              <p className="mt-1.5 text-[10px] text-rose-400 tracking-wide">Passwords do not match</p>
            )}
          </div>

          {pwError && (
            <p className="border border-rose-500/20 bg-rose-500/[0.04] px-4 py-2.5 text-xs text-rose-300">{pwError}</p>
          )}

          <button
            type="submit"
            disabled={pwSaving || !newPassword || !confirmPassword || newPassword !== confirmPassword}
            className="w-full border border-emerald-500/40 bg-emerald-500/10 py-3 text-[10px] font-semibold tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {pwSaving ? 'Saving...' : pwSaved ? '✓ Password Updated' : merchant.hasPassword ? 'Update Password' : 'Set Password'}
          </button>
        </form>
      )}

      {/* ── QR CODE TAB ── */}
      {tab === 'qr' && (
        <div key="qr" className="tab-content">
          <QrCustomizer payUrl={payUrl} handle={merchant.handle} />
        </div>
      )}

      {/* ── AI AGENT TAB ── */}
      {tab === 'ai' && <AiAgentSettings />}
    </div>
  );
}

function AiAgentSettings() {
  const { agentName, setAgentName, agentEnabled, setAgentEnabled } = useAiAssistant();
  const [nameInput, setNameInput] = useState(agentName);
  const [saved, setSaved] = useState(false);

  function save() {
    const trimmed = nameInput.trim() || 'Ubongo AI';
    setAgentName(trimmed);
    setNameInput(trimmed);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="tab-content space-y-6">
      {/* Enable toggle */}
      <div className="flex items-center justify-between border border-white/10 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-white/80">AI Agent</p>
          <p className="text-[10px] text-white/35 tracking-wide mt-0.5">
            {agentEnabled ? 'Active — visible in your dashboard' : 'Inactive — hidden from dashboard'}
          </p>
        </div>
        <button
          onClick={() => setAgentEnabled(!agentEnabled)}
          className={`relative h-6 w-11 shrink-0 transition-colors duration-200 ${agentEnabled ? 'bg-emerald-500' : 'bg-white/15'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 bg-white transition-transform duration-200 ${agentEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {agentEnabled && (
        <>
          {/* Name */}
          <div>
            <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
              Agent Name
            </label>
            <input
              type="text"
              value={nameInput}
              onChange={e => { setNameInput(e.target.value); setSaved(false); }}
              onKeyDown={e => e.key === 'Enter' && save()}
              placeholder="Ubongo AI"
              maxLength={32}
              className="w-full border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-emerald-500/50 focus:outline-none transition-colors"
            />
            <p className="mt-1.5 text-[10px] text-white/25">
              This name appears in the chat header and the AI introduces itself by it.
            </p>
          </div>

          {/* Preview */}
          <div className="border border-white/8 bg-white/[0.02] p-4 space-y-2">
            <p className="text-[9px] tracking-widest text-white/30 uppercase mb-3">Preview</p>
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center border border-emerald-500/30 bg-emerald-500/10">
                <Sparkles size={13} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-bold tracking-wider text-white uppercase">{nameInput || 'Ubongo AI'}</p>
                <p className="text-[10px] text-white/30">msaidizi wa duka lako</p>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[9px] text-emerald-400/60 tracking-widest uppercase">Active</span>
              </div>
            </div>
          </div>

          <button
            onClick={save}
            className="w-full border border-emerald-500/40 bg-emerald-500/10 py-3 text-[10px] font-semibold tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 transition-colors"
          >
            {saved ? '✓ Saved' : 'Save Agent Settings'}
          </button>
        </>
      )}
    </div>
  );
}
