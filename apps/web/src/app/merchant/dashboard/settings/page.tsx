'use client';

import { useState, useEffect } from 'react';
import { useMerchant } from '../layout';
import { Copy, Check } from 'lucide-react';
import { QrCustomizer } from './QrCustomizer';

export default function SettingsPage() {
  const { merchant, refresh } = useMerchant();
  const [businessName, setBusinessName] = useState('');
  const [settlePct, setSettlePct] = useState(0);
  const [settlementPhone, setSettlementPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (merchant) {
      setBusinessName(merchant.businessName ?? '');
      setSettlePct(merchant.settlePct);
      setSettlementPhone(merchant.settlementPhone ?? '');
    }
  }, [merchant]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const profileRes = await fetch('/merchant/api/merchant/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName }),
      });
      if (!profileRes.ok) throw new Error((await profileRes.json()).error);

      const settlementRes = await fetch('/merchant/api/merchant/settlement', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settlePct, settlementPhone }),
      });
      if (!settlementRes.ok) throw new Error((await settlementRes.json()).error);

      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (!merchant) return null;

  const grossPreview = Math.trunc(10000 * settlePct / 100);
  const netPreview = Math.trunc((grossPreview - 1500) * 0.995);

  return (
    <div className="p-6 max-w-xl mx-auto font-mono">

      <div className="flex items-center gap-3 mb-6">
        <div className="w-4 h-px bg-emerald-400/60" />
        <span className="text-[10px] tracking-widest text-white/40 uppercase">Dashboard / Settings</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      <form onSubmit={handleSave} className="space-y-5">

        {/* Business Profile */}
        <section className="relative border border-white/10 p-5">
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-white/20" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white/20" />

          <p className="text-xs font-semibold tracking-widest text-white/50 uppercase mb-4">Business Profile</p>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">Business Name</label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="My Business"
                className="w-full border border-white/15 bg-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">Handle</label>
              <div className="flex items-center gap-2 border border-white/10 bg-white/[0.03] px-4 py-2.5">
                <span className="text-white/40 text-sm">@</span>
                <span className="text-sm text-white/70 flex-1">{merchant.handle}</span>
              </div>
              <p className="mt-1.5 text-xs text-white/35">Handle is permanent and cannot be changed</p>
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">Wallet Address</label>
              <div className="flex items-center gap-2 border border-white/10 bg-white/[0.03] px-4 py-2.5">
                <span className="flex-1 truncate text-xs text-white/50">{merchant.walletAddress}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(merchant.walletAddress);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="text-white/25 hover:text-white/60 transition-colors"
                >
                  {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Auto-Settlement */}
        <section className="relative border border-white/10 p-5">
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-white/20" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white/20" />

          <p className="text-xs font-semibold tracking-widest text-white/50 uppercase mb-1">Auto-Settlement</p>
          <p className="text-xs text-white/40 mb-5 leading-relaxed">
            Set a percentage of every confirmed collection to be automatically sent to your mobile money number.
          </p>

          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-medium tracking-widest text-white/50 uppercase">Settlement Percentage</label>
                <span className="text-sm font-bold text-emerald-400">{settlePct}%</span>
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
              <div className="flex justify-between text-[10px] text-white/40 mt-1.5 tracking-wide">
                <span>0% — Off</span>
                <span>100%</span>
              </div>
            </div>

            {settlePct > 0 && (
              <>
                <div>
                  <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">Mobile Money Phone</label>
                  <input
                    type="tel"
                    placeholder="07XX XXX XXX"
                    value={settlementPhone}
                    onChange={(e) => setSettlementPhone(e.target.value)}
                    className="w-full border border-white/15 bg-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none"
                  />
                </div>

                {netPreview > 0 ? (
                  <div className="border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-3">
                    <p className="text-[10px] font-medium tracking-widest text-emerald-400/80 uppercase mb-1">Payout Preview</p>
                    <p className="text-xs text-white/60 leading-relaxed">
                      For a 10,000 TZS collection, you receive{' '}
                      <span className="font-bold text-emerald-400">{netPreview.toLocaleString()} TZS</span>
                      {settlementPhone && ` to ${settlementPhone}`}
                      <span className="block mt-0.5 text-[10px] text-white/40">
                        After 1,500 TZS transfer fee + 0.5% platform fee
                      </span>
                    </p>
                  </div>
                ) : netPreview <= 0 && settlePct > 0 ? (
                  <div className="border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3">
                    <p className="text-xs text-amber-400 leading-relaxed">
                      Settlement percentage too low to cover transfer fees on a 10,000 TZS collection.
                      Raise the percentage or wait for a larger collection.
                    </p>
                  </div>
                ) : null}

                <p className="text-xs text-white/40 leading-relaxed">
                  Minimum payout threshold: 5,000 TZS. Collections below this accumulate until the threshold is reached.
                </p>
              </>
            )}
          </div>
        </section>

        {error && (
          <p className="border border-rose-500/20 bg-rose-500/[0.03] px-4 py-2.5 text-xs text-rose-300">{error}</p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full border border-emerald-500/40 bg-emerald-500/10 py-3 text-[10px] font-medium tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Settings'}
        </button>
      </form>

      {/* QR Code — outside the form so it doesn't interfere with save */}
      <div className="mt-5">
        <QrCustomizer
          payUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/m/${merchant.handle}`}
          handle={merchant.handle}
        />
      </div>
    </div>
  );
}
