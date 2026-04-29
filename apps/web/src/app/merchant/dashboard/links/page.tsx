'use client';

import { useState, useEffect } from 'react';
import { useMerchant } from '../layout';
import { Copy, Plus, X } from 'lucide-react';

interface PayLink {
  id: string;
  type: 'fixed' | 'open';
  amountTzs: number | null;
  description: string | null;
  slug: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function LinksPage() {
  const { merchant } = useMerchant();
  const [links, setLinks] = useState<PayLink[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<'fixed' | 'open'>('open');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  const base = typeof window !== 'undefined' ? window.location.origin : '';

  async function loadLinks() {
    const res = await fetch('/merchant/api/merchant/links');
    const data = await res.json();
    setLinks(data.links ?? []);
  }

  useEffect(() => { loadLinks(); }, []);

  async function createLink(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setCreating(true);
    try {
      const res = await fetch('/merchant/api/merchant/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          amountTzs: type === 'fixed' ? Number(amount) : undefined,
          description: description || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setFormError(d.error || 'Failed to create link');
        return;
      }
      await loadLinks();
      setShowForm(false);
      setType('open');
      setAmount('');
      setDescription('');
    } finally {
      setCreating(false);
    }
  }

  function linkUrl(link: PayLink): string {
    const handle = merchant?.handle ?? '';
    if (link.type === 'fixed') return `${base}/m/${handle}?link=${link.id}`;
    return `${base}/m/${handle}`;
  }

  function copyLink(link: PayLink) {
    navigator.clipboard.writeText(linkUrl(link)).then(() => {
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  return (
    <div className="p-6 max-w-2xl mx-auto font-mono">

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-4 h-px bg-emerald-400/60" />
          <span className="text-[10px] tracking-widest text-white/30 uppercase">Dashboard / Payment Links</span>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-[10px] tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 transition-colors"
        >
          <Plus size={11} />
          New Link
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={createLink} className="relative mb-5 border border-white/10 bg-white/[0.02] p-5 space-y-5">
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-emerald-500/30" />
          <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-emerald-500/30" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-emerald-500/30" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-emerald-500/30" />

          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-widest text-white/40 uppercase">New Payment Link</span>
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormError(''); }}
              className="text-white/25 hover:text-white/60 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex gap-2">
            {(['open', 'fixed'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 py-2 text-[10px] tracking-widest uppercase transition-colors ${
                  type === t
                    ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : 'border border-white/10 text-white/30 hover:bg-white/[0.03]'
                }`}
              >
                {t === 'open' ? 'Customer Sets Amount' : 'Fixed Amount'}
              </button>
            ))}
          </div>

          {type === 'fixed' && (
            <div>
              <label className="mb-2 block text-[10px] tracking-widest text-white/40 uppercase">Amount (TZS)</label>
              <input
                type="number"
                required
                min={100}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="5000"
                className="w-full border border-white/10 bg-black px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          )}

          <div>
            <label className="mb-2 block text-[10px] tracking-widest text-white/40 uppercase">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Delivery fee, Invoice #123"
              className="w-full border border-white/10 bg-black px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-500/50"
            />
          </div>

          {formError && (
            <p className="border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{formError}</p>
          )}

          <button
            type="submit"
            disabled={creating}
            className="w-full border border-emerald-500/40 bg-emerald-500/10 py-2.5 text-[10px] tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
          >
            {creating ? 'Creating...' : 'Create Link'}
          </button>
        </form>
      )}

      {/* Links list */}
      {links.length === 0 ? (
        <div className="border border-white/5 p-12 text-center">
          <p className="text-xs text-white/30 tracking-wide">No payment links yet</p>
          <p className="mt-1 text-[10px] text-white/15">Create a fixed-amount link for specific products or invoices</p>
        </div>
      ) : (
        <div className="border border-white/5 divide-y divide-white/[0.04]">
          {links.map((link) => (
            <div key={link.id} className="px-4 py-4 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`border px-2 py-0.5 text-[9px] tracking-widest uppercase ${
                      link.type === 'fixed'
                        ? 'border-blue-500/20 bg-blue-500/5 text-blue-400'
                        : 'border-white/10 bg-white/[0.03] text-white/40'
                    }`}>
                      {link.type === 'fixed' ? `${link.amountTzs?.toLocaleString()} TZS` : 'Open'}
                    </span>
                    {!link.isActive && (
                      <span className="border border-white/10 px-2 py-0.5 text-[9px] tracking-widest uppercase text-white/25">
                        Inactive
                      </span>
                    )}
                  </div>
                  {link.description && (
                    <p className="text-xs text-white/70 truncate mb-1">{link.description}</p>
                  )}
                  <p className="text-[10px] text-white/20 truncate">{linkUrl(link)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => copyLink(link)}
                  className="shrink-0 border border-white/10 px-3 py-1.5 text-[10px] tracking-wider text-white/35 uppercase hover:bg-white/5 hover:text-white/60 transition-colors flex items-center gap-1.5"
                >
                  <Copy size={10} />
                  {copiedId === link.id ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
