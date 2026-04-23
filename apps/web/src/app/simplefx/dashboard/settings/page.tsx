'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Copy, AlertCircle, Pencil, RefreshCw, Eye, EyeOff, Trash2 } from 'lucide-react';
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
  const [generatingKey, setGeneratingKey] = useState(false);
  const [revokingKey, setRevokingKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  if (!lp) return null;

  const generateKey = async () => {
    setGeneratingKey(true);
    setNewApiKey(null);
    const res = await fetch('/simplefx/api/lp/api-key', { method: 'POST' });
    const data = await res.json();
    if (data.apiKey) {
      setNewApiKey(data.apiKey);
      setKeyVisible(true);
    }
    await refresh();
    setGeneratingKey(false);
  };

  const revokeKey = async () => {
    if (!confirm('Revoke the API key? Any integrations using it will stop working immediately.')) return;
    setRevokingKey(true);
    await fetch('/simplefx/api/lp/api-key', { method: 'DELETE' });
    setNewApiKey(null);
    await refresh();
    setRevokingKey(false);
  };

  const copyKey = () => {
    if (newApiKey) {
      navigator.clipboard.writeText(newApiKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    }
  };

  const saveName = async () => {
    setSavingName(true);
    await fetch('/simplefx/api/lp/profile', {
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
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Settings</p>
        <h1 className="text-3xl font-thin text-white mb-8">Account</h1>

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
              <button onClick={saveName} disabled={savingName} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50">
                {savingName ? 'Saving' : 'Save'}
              </button>
              <button onClick={() => setEditingName(false)} className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-300">
                {lp.displayName ?? <span className="text-zinc-600 italic">Not set</span>}
              </p>
              <button onClick={() => { setNameInput(lp.displayName ?? ''); setEditingName(true); }} className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
                <Pencil size={12} /> Edit
              </button>
            </div>
          )}
        </div>

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

        {lp.kycStatus === 'pending' && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-950/20 mb-6">
            <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-amber-300 font-medium mb-1">KYC verification pending</p>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Identity verification is required before your position can go live. Please contact{' '}
                <a href="mailto:devops@ntzs.co.tz" className="text-blue-400 underline">devops@ntzs.co.tz</a>{' '}
                to complete your verification.
              </p>
            </div>
          </div>
        )}

        {/* API Key */}
        <div className="rounded-xl border border-white/5 bg-zinc-950 p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-600">Market Maker API Key</p>
            {lp.hasApiKey && !newApiKey && (
              <button
                onClick={revokeKey}
                disabled={revokingKey}
                className="flex items-center gap-1.5 text-xs text-red-500/70 hover:text-red-400 transition-colors disabled:opacity-40"
              >
                <Trash2 size={12} />
                {revokingKey ? 'Revoking...' : 'Revoke'}
              </button>
            )}
          </div>

          {newApiKey ? (
            <div className="space-y-3">
              <p className="text-xs text-amber-400/80">
                Copy this key now — it will not be shown again.
              </p>
              <div className="flex items-center gap-2 bg-black/40 border border-white/8 rounded-lg px-3 py-2">
                <code className="flex-1 text-xs font-mono text-zinc-300 truncate">
                  {keyVisible ? newApiKey : newApiKey.slice(0, 12) + '•'.repeat(24)}
                </code>
                <button onClick={() => setKeyVisible(v => !v)} className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors">
                  {keyVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button onClick={copyKey} className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors">
                  {keyCopied ? <CheckCircle2 size={13} className="text-blue-400" /> : <Copy size={13} />}
                </button>
              </div>
              <button
                onClick={() => setNewApiKey(null)}
                className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                I have saved my key
              </button>
            </div>
          ) : lp.hasApiKey ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                <span className="text-sm text-zinc-400">Key configured</span>
              </div>
              <button
                onClick={generateKey}
                disabled={generatingKey}
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={12} />
                {generatingKey ? 'Rotating...' : 'Rotate key'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500 leading-relaxed">
                Generate an API key to connect programmatically via the Market Maker API.
                See the <a href="/simplefx/docs/api-reference" className="text-blue-400 hover:text-blue-300 transition-colors">API Reference</a> for usage.
              </p>
              <button
                onClick={generateKey}
                disabled={generatingKey}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600/15 text-blue-400 border border-blue-500/25 hover:bg-blue-600/25 transition-colors disabled:opacity-50"
              >
                {generatingKey ? 'Generating...' : 'Generate API key'}
              </button>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/5 bg-zinc-950 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-4">Legal</p>
          <div className="space-y-2">
            {[
              { label: 'Terms of Service', href: '/simplefx/terms' },
              { label: 'Privacy Policy', href: '/simplefx/privacy' },
              { label: 'Documentation', href: '/simplefx/docs' },
            ].map(({ label, href }) => (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between py-2 text-sm text-zinc-500 hover:text-zinc-200 transition-colors">
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
