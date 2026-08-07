'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Plus, Trash2, Wallet, Landmark } from 'lucide-react';

import { SelectMenu } from './SelectMenu';

interface Destination {
  id: string;
  kind: 'crypto' | 'bank';
  label: string;
  chain: string | null;
  address: string | null;
  bankCode: string | null;
  accountNumber: string | null;
  createdAt: string;
}

const CHAIN_OPTIONS = [
  { value: 'base', label: 'Base' },
  { value: 'bnb', label: 'BNB Smart Chain' },
];

const CHAIN_LABEL: Record<string, string> = { base: 'Base', bnb: 'BNB Smart Chain' };

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      aria-label="Copy"
      className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-300"
    >
      {copied ? <Check size={13} className="text-blue-400" /> : <Copy size={13} />}
    </button>
  );
}

/**
 * Where this account's money is allowed to go, and the only place to review it.
 *
 * Destinations can be added mid-withdrawal, which is convenient but a bad place
 * to audit: nobody reviews a list while they are trying to send. This is the
 * standing view — everything saved, what it points at, and how to remove one
 * that is no longer in use.
 */
export default function PayoutDestinations({ isBank }: { isBank: boolean }) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [banks, setBanks] = useState<Array<{ code: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [canWrite, setCanWrite] = useState(true);

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<'crypto' | 'bank'>('crypto');
  const [label, setLabel] = useState('');
  const [chain, setChain] = useState('base');
  const [address, setAddress] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await (await fetch('/simplefx/api/lp/destinations')).json();
      setDestinations((d.destinations ?? []) as Destination[]);
      setCanWrite(d.you?.canWrite ?? false);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // The shilling rail only exists for bank accounts, so only they can use a
  // saved bank destination — and only while payouts are switched on.
  const bankKindAvailable = isBank && banks.length > 0;

  useEffect(() => {
    if (!isBank) return;
    fetch('/simplefx/api/lp/banks')
      .then((r) => r.json())
      .then((d) => setBanks(d.banks ?? []))
      .catch(() => {});
  }, [isBank]);

  const reset = () => {
    setLabel(''); setAddress(''); setAccountNumber(''); setError('');
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    const body = kind === 'bank'
      ? { kind, label: label.trim(), bankCode, accountNumber }
      : { kind, label: label.trim(), chain, address: address.trim() };
    try {
      const res = await fetch('/simplefx/api/lp/destinations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) setError(d?.error || 'Could not save that destination.');
      else { reset(); setAdding(false); await load(); }
    } catch { setError('Network error. Please try again.'); }
    setBusy(false);
  };

  const remove = async (d: Destination) => {
    if (!confirm(`Remove "${d.label}"? Withdrawals already sent are unaffected.`)) return;
    setError(''); setRemoving(d.id);
    try {
      const res = await fetch('/simplefx/api/lp/destinations', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destinationId: d.id }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) setError(j?.error || 'Could not remove that destination.');
      else await load();
    } catch { setError('Network error. Please try again.'); }
    setRemoving(null);
  };

  const bankName = (code: string | null) =>
    banks.find((b) => b.code === code)?.name ?? code ?? 'Unknown bank';

  return (
    <div className="mb-4 rounded-xl border border-white/5 bg-zinc-950 p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-600">Payout destinations</p>
        {canWrite && !adding && (
          <button
            onClick={() => { setAdding(true); setKind(bankKindAvailable ? kind : 'crypto'); }}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-600 transition-colors hover:text-zinc-300"
          >
            <Plus size={12} /> Add
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-blue-400" /></div>
      ) : destinations.length === 0 ? (
        <p className="py-2 text-sm text-zinc-600">
          None saved. Add one here, or save it as you make a withdrawal.
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {destinations.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="shrink-0 text-zinc-700">
                  {d.kind === 'crypto' ? <Wallet size={14} /> : <Landmark size={14} />}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm text-zinc-300">{d.label}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-zinc-600">
                    {d.kind === 'crypto'
                      ? `${CHAIN_LABEL[d.chain ?? ''] ?? d.chain} · ${d.address}`
                      : `${bankName(d.bankCode)} · ${d.accountNumber}`}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <CopyValue value={(d.kind === 'crypto' ? d.address : d.accountNumber) ?? ''} />
                {canWrite && (
                  <button
                    onClick={() => remove(d)}
                    disabled={removing === d.id}
                    aria-label={`Remove ${d.label}`}
                    className="text-zinc-600 transition-colors hover:text-red-400 disabled:opacity-40"
                  >
                    {removing === d.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form onSubmit={add} className="mt-4 space-y-3 border-t border-white/5 pt-4">
          {bankKindAvailable && (
            <div className="flex w-fit gap-2 rounded-lg border border-white/5 bg-black/40 p-1">
              {([
                { id: 'crypto', label: 'Address' },
                { id: 'bank', label: 'Bank account' },
              ] as const).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => { setKind(k.id); setError(''); }}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    kind === k.id ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          )}

          <input
            value={label}
            onChange={(e) => { setLabel(e.target.value); setError(''); }}
            placeholder={kind === 'bank' ? 'Name this account' : 'Name this address, e.g. Treasury custody'}
            maxLength={60}
            className="w-full rounded-lg border border-white/8 bg-black/40 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-blue-500/40 focus:outline-none"
          />

          {kind === 'crypto' ? (
            <>
              <SelectMenu ariaLabel="Network" value={chain} onChange={setChain} options={CHAIN_OPTIONS} searchable={false} />
              <input
                value={address}
                onChange={(e) => { setAddress(e.target.value); setError(''); }}
                placeholder="0x..."
                className="w-full rounded-lg border border-white/8 bg-black/40 px-3 py-2.5 font-mono text-sm text-white placeholder-zinc-700 focus:border-blue-500/40 focus:outline-none"
              />
            </>
          ) : (
            <>
              <SelectMenu
                ariaLabel="Bank"
                value={bankCode}
                onChange={setBankCode}
                options={banks.map((b) => ({ value: b.code, label: b.name }))}
                placeholder="Choose the bank"
              />
              <input
                inputMode="numeric"
                value={accountNumber}
                onChange={(e) => { setAccountNumber(e.target.value); setError(''); }}
                placeholder="Account number"
                className="w-full rounded-lg border border-white/8 bg-black/40 px-3 py-2.5 font-mono text-sm text-white placeholder-zinc-700 focus:border-blue-500/40 focus:outline-none"
              />
            </>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || !label.trim() || (kind === 'bank' ? !bankCode || !accountNumber.trim() : !address.trim())}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
            >
              {busy ? 'Saving' : 'Save destination'}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); reset(); }}
              className="px-3 py-2 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!adding && error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </div>
  );
}
