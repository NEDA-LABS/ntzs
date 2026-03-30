'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Copy, AlertCircle, Pencil } from 'lucide-react';
import { useLp } from '../layout';

function InfoRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <p className="text-xs text-zinc-600 uppercase tracking-[0.2em] w-32 shrink-0">{label}</p>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <p className="text-sm text-zinc-300 font-mono truncate">{value}</p>
        <button onClick={copy} className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors">
          {copied ? <CheckCircle2 size={13} className="text-blue-400" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { lp, refresh } = useLp();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  if (!lp) return null;

  const saveName = async () => {
    setSavingName(true);
    await fetch('/api/lp/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: nameInput }),
    });
    await refresh();
    setSavingName(false);
    setEditingName(false);
  };

  const kycColor = {
    pending: 'text-amber-400',
    approved: 'text-blue-400',
    rejected: 'text-red-400',
  }[lp.kycStatus];

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Settings</p>
        <h1 className="text-3xl font-thin text-white mb-8">Account</h1>

        {/* Display name */}
        <div className="rounded-xl border border-white/5 bg-zinc-950 p-5 mb-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-4">Display name</p>
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
                placeholder="e.g. Acme Capital"
                maxLength={80}
                className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
              />
              <button
                onClick={saveName}
                disabled={savingName}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
              >
                {savingName ? 'Saving' : 'Save'}
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-300">
                {lp.displayName ?? <span className="text-zinc-600 italic">Not set</span>}
              </p>
              <button
                onClick={() => { setNameInput(lp.displayName ?? ''); setEditingName(true); }}
                className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                <Pencil size={12} /> Edit
              </button>
            </div>
          )}
        </div>

        {/* Account info */}
        <div className="rounded-xl border border-white/5 bg-zinc-950 p-5 mb-6">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-4">Account details</p>
          <InfoRow label="LP ID" value={lp.id} />
          <InfoRow label="Email" value={lp.email} />
          <InfoRow label="Wallet" value={lp.walletAddress} />
          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <p className="text-xs text-zinc-600 uppercase tracking-[0.2em] w-32 shrink-0">KYC Status</p>
            <span className={`text-sm font-medium ${kycColor}`}>
              {lp.kycStatus.charAt(0).toUpperCase() + lp.kycStatus.slice(1)}
            </span>
          </div>
          <div className="flex items-center justify-between py-3">
            <p className="text-xs text-zinc-600 uppercase tracking-[0.2em] w-32 shrink-0">Member since</p>
            <p className="text-sm text-zinc-400">
              {new Date(lp.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* KYC notice */}
        {lp.kycStatus === 'pending' && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-950/20 mb-6">
            <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-amber-300 font-medium mb-1">KYC verification pending</p>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Identity verification is required before your position can go live. Please contact{' '}
                <a href="mailto:support@nedapay.xyz" className="text-blue-400 underline">support@nedapay.xyz</a>{' '}
                to complete your verification.
              </p>
            </div>
          </div>
        )}

        {/* Legal links */}
        <div className="rounded-xl border border-white/5 bg-zinc-950 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-4">Legal</p>
          <div className="space-y-2">
            {[
              { label: 'Terms of Service', href: '/terms' },
              { label: 'Privacy Policy', href: '/privacy' },
              { label: 'Documentation', href: '/docs' },
            ].map(({ label, href }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between py-2 text-sm text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                {label}
                <span className="text-zinc-700 text-xs">Open</span>
              </a>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
