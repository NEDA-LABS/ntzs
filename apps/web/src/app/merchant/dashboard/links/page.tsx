'use client';

import { useState, useEffect, useRef } from 'react';
import { useMerchant } from '../layout';
import { Copy, Plus, X, Trash2, Upload, Tag, Share2, MessageCircle, Send, ExternalLink } from 'lucide-react';

interface PayLink {
  id: string;
  type: 'fixed' | 'open';
  productName: string | null;
  imageUrl: string | null;
  amountTzs: number | null;
  originalAmountTzs: number | null;
  discountPct: number;
  description: string | null;
  slug: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function LinksPage() {
  const { merchant } = useMerchant();
  const [links, setLinks] = useState<PayLink[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<'fixed' | 'open'>('fixed');
  const [productName, setProductName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [amount, setAmount] = useState('');
  const [enableDiscount, setEnableDiscount] = useState(false);
  const [discountPct, setDiscountPct] = useState(10);
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const base = typeof window !== 'undefined' ? window.location.origin : '';

  async function loadLinks() {
    const res = await fetch('/merchant/api/merchant/links');
    const data = await res.json();
    setLinks(data.links ?? []);
  }

  useEffect(() => { loadLinks(); }, []);

  function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setImagePreview(url);
      setImageUrl(url);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleImageUrlInput(val: string) {
    setImageUrl(val);
    setImagePreview(val);
  }

  function resetForm() {
    setType('fixed');
    setProductName('');
    setImageUrl('');
    setImagePreview('');
    setAmount('');
    setEnableDiscount(false);
    setDiscountPct(10);
    setDescription('');
    setFormError('');
  }

  const discountedAmount = enableDiscount && amount
    ? Math.round(Number(amount) * (1 - discountPct / 100))
    : Number(amount);

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
          productName: productName || undefined,
          imageUrl: imageUrl || undefined,
          amountTzs: type === 'fixed' && !enableDiscount ? Number(amount) : undefined,
          originalAmountTzs: type === 'fixed' && enableDiscount ? Number(amount) : undefined,
          discountPct: enableDiscount ? discountPct : 0,
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
      resetForm();
    } finally {
      setCreating(false);
    }
  }

  async function deleteLink(id: string) {
    await fetch(`/merchant/api/merchant/links?id=${id}`, { method: 'DELETE' });
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }

  function linkUrl(link: PayLink): string {
    const handle = merchant?.handle ?? '';
    return `${base}/m/${handle}?link=${link.id}`;
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
          onClick={() => { setShowForm(true); resetForm(); }}
          className="flex items-center gap-2 border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-[10px] tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 transition-colors"
        >
          <Plus size={11} />
          New Link
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={createLink} className="relative mb-6 border border-white/10 bg-white/[0.02] p-5 space-y-5">
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-emerald-500/30" />
          <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-emerald-500/30" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-emerald-500/30" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-emerald-500/30" />

          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-widest text-white/40 uppercase">New Payment Link</span>
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="text-white/25 hover:text-white/60 transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Type toggle */}
          <div className="grid grid-cols-2 gap-2">
            {(['fixed', 'open'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={`py-2 text-[10px] tracking-widest uppercase transition-colors ${
                  type === t ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border border-white/10 text-white/30 hover:bg-white/[0.03]'
                }`}>
                {t === 'fixed' ? 'Fixed Amount' : 'Customer Sets Amount'}
              </button>
            ))}
          </div>

          {/* Product name */}
          <div>
            <label className="mb-2 block text-[10px] tracking-widest text-white/40 uppercase">Product Name</label>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="Summer Dress, Invoice #42, Event Ticket..."
              className="w-full border border-white/10 bg-black px-4 py-2.5 text-sm text-white placeholder:text-white/15 focus:outline-none focus:border-emerald-500/40"
            />
          </div>

          {/* Product image */}
          <div>
            <label className="mb-2 block text-[10px] tracking-widest text-white/40 uppercase">Product Image</label>
            {imagePreview ? (
              <div className="relative border border-white/10">
                <img src={imagePreview} alt="preview" className="w-full h-40 object-cover" />
                <button
                  type="button"
                  onClick={() => { setImageUrl(''); setImagePreview(''); }}
                  className="absolute top-2 right-2 border border-white/20 bg-black/70 p-1 text-white/60 hover:text-white transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 w-full border border-dashed border-white/15 px-4 py-3 text-[10px] tracking-wider text-white/25 uppercase hover:border-white/30 hover:text-white/40 transition-colors"
                >
                  <Upload size={11} />
                  Upload image
                </button>
                <input
                  type="url"
                  placeholder="Or paste image URL..."
                  value={imageUrl}
                  onChange={(e) => handleImageUrlInput(e.target.value)}
                  className="w-full border border-white/10 bg-black px-4 py-2 text-xs text-white placeholder:text-white/15 focus:outline-none focus:border-emerald-500/40"
                />
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
          </div>

          {/* Price */}
          {type === 'fixed' && (
            <div>
              <label className="mb-2 block text-[10px] tracking-widest text-white/40 uppercase">
                {enableDiscount ? 'Original Price (TZS)' : 'Price (TZS)'}
              </label>
              <input
                type="number"
                required
                min={100}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="25000"
                className="w-full border border-white/10 bg-black px-4 py-2.5 text-sm text-white placeholder:text-white/15 focus:outline-none focus:border-emerald-500/40"
              />
            </div>
          )}

          {/* Discount */}
          {type === 'fixed' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-[10px] tracking-widest text-white/40 uppercase flex items-center gap-2">
                  <Tag size={10} />
                  Discount / Promo
                </label>
                <button
                  type="button"
                  onClick={() => setEnableDiscount(!enableDiscount)}
                  className={`px-3 py-1 text-[10px] tracking-widest uppercase border transition-colors ${
                    enableDiscount
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-white/10 text-white/25 hover:bg-white/5'
                  }`}
                >
                  {enableDiscount ? 'On' : 'Off'}
                </button>
              </div>

              {enableDiscount && (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] text-white/30">Discount</span>
                      <span className="text-sm font-bold text-emerald-400">{discountPct}% off</span>
                    </div>
                    <input
                      type="range" min={5} max={90} step={5}
                      value={discountPct}
                      onChange={(e) => setDiscountPct(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>

                  {amount && discountedAmount >= 100 && (
                    <div className="border border-emerald-500/15 bg-emerald-500/[0.03] px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] tracking-widest text-white/25 uppercase mb-1">Customer pays</p>
                          <p className="text-lg font-bold text-emerald-400">{discountedAmount.toLocaleString()} TZS</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] tracking-widest text-white/25 uppercase mb-1">Was</p>
                          <p className="text-sm text-white/35 line-through">{Number(amount).toLocaleString()} TZS</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Description */}
          <div>
            <label className="mb-2 block text-[10px] tracking-widest text-white/40 uppercase">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Any extra details for the buyer..."
              className="w-full border border-white/10 bg-black px-4 py-2.5 text-sm text-white placeholder:text-white/15 focus:outline-none focus:border-emerald-500/40"
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
          <p className="mt-1 text-[10px] text-white/15">Create a product link with an image and custom price</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map((link) => (
            <ProductLinkCard
              key={link.id}
              link={link}
              url={linkUrl(link)}
              copied={copiedId === link.id}
              onCopy={() => copyLink(link)}
              onDelete={() => deleteLink(link.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductLinkCard({
  link, url, copied, onCopy, onDelete,
}: {
  link: PayLink;
  url: string;
  copied: boolean;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const hasDiscount = link.discountPct > 0 && link.originalAmountTzs;
  const [shareOpen, setShareOpen] = useState(false);

  const shareText = link.productName
    ? `${link.productName}${link.amountTzs ? ` — ${link.amountTzs.toLocaleString()} TZS` : ''}${hasDiscount ? ` (${link.discountPct}% off!)` : ''}`
    : 'Pay via nTZS Biashara';

  function shareWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${url}`)}`, '_blank');
    setShareOpen(false);
  }

  function shareTelegram() {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`, '_blank');
    setShareOpen(false);
  }

  function shareTwitter() {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${shareText} ${url}`)}`, '_blank');
    setShareOpen(false);
  }

  async function shareNative() {
    if (navigator.share) {
      try {
        await navigator.share({ title: shareText, url });
      } catch { /* user cancelled */ }
    }
    setShareOpen(false);
  }

  return (
    <div className="relative border border-white/5 bg-white/[0.02] overflow-hidden group">
      {/* Product image strip */}
      {link.imageUrl && (
        <div className="relative h-32 w-full overflow-hidden border-b border-white/5">
          <img src={link.imageUrl} alt={link.productName ?? ''} className="w-full h-full object-cover" />
          {hasDiscount && (
            <div className="absolute top-2 left-2 border border-emerald-500/60 bg-black/80 px-2 py-0.5 text-[10px] font-bold tracking-widest text-emerald-400 uppercase">
              Save {link.discountPct}%
            </div>
          )}
          {link.type === 'open' && (
            <div className="absolute top-2 right-2 border border-white/20 bg-black/70 px-2 py-0.5 text-[9px] tracking-widest text-white/50 uppercase">
              Open
            </div>
          )}
        </div>
      )}

      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* Name + badges */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {link.productName && (
                <p className="text-sm font-medium text-white truncate">{link.productName}</p>
              )}
              {!link.imageUrl && link.type === 'open' && (
                <span className="border border-white/10 px-2 py-0.5 text-[9px] tracking-widest text-white/35 uppercase">Open</span>
              )}
              {!link.isActive && (
                <span className="border border-white/10 px-2 py-0.5 text-[9px] tracking-widest text-white/25 uppercase">Inactive</span>
              )}
            </div>

            {/* Pricing */}
            {link.type === 'fixed' && link.amountTzs && (
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-bold text-emerald-400">{link.amountTzs.toLocaleString()} TZS</span>
                {hasDiscount && (
                  <span className="text-xs text-white/30 line-through">{link.originalAmountTzs!.toLocaleString()} TZS</span>
                )}
              </div>
            )}

            {link.description && (
              <p className="text-[10px] text-white/30 truncate">{link.description}</p>
            )}
            <p className="text-[10px] text-white/15 truncate mt-0.5">{url}</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onCopy}
              className="border border-white/10 px-3 py-1.5 text-[10px] tracking-wider text-white/35 uppercase hover:bg-white/5 hover:text-white/60 transition-colors flex items-center gap-1.5"
            >
              <Copy size={10} />
              {copied ? 'Copied' : 'Copy'}
            </button>

            {/* Share button + sheet */}
            <div className="relative">
              <button
                onClick={() => setShareOpen((o) => !o)}
                className={`border px-3 py-1.5 text-[10px] tracking-wider uppercase transition-colors flex items-center gap-1.5 ${
                  shareOpen
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : 'border-white/10 text-white/35 hover:bg-white/5 hover:text-white/60'
                }`}
              >
                <Share2 size={10} />
                Share
              </button>

              {shareOpen && (
                <>
                  {/* Backdrop */}
                  <div className="fixed inset-0 z-10" onClick={() => setShareOpen(false)} />
                  {/* Sheet */}
                  <div className="absolute right-0 top-full mt-1 z-20 border border-white/10 bg-zinc-950 min-w-[160px] py-1 shadow-xl">
                    <div className="px-3 py-1.5 border-b border-white/5 mb-1">
                      <p className="text-[9px] tracking-widest text-white/25 uppercase">Share via</p>
                    </div>
                    <button
                      onClick={shareWhatsApp}
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-[11px] text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors"
                    >
                      <MessageCircle size={12} className="text-green-400" />
                      WhatsApp
                    </button>
                    <button
                      onClick={shareTelegram}
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-[11px] text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors"
                    >
                      <Send size={12} className="text-sky-400" />
                      Telegram
                    </button>
                    <button
                      onClick={shareTwitter}
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-[11px] text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors"
                    >
                      <ExternalLink size={12} className="text-white/40" />
                      X / Twitter
                    </button>
                    {typeof navigator !== 'undefined' && 'share' in navigator && (
                      <button
                        onClick={shareNative}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-[11px] text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors border-t border-white/5 mt-1"
                      >
                        <Share2 size={12} className="text-white/40" />
                        More options...
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={onDelete}
              className="border border-white/10 p-1.5 text-white/20 hover:text-rose-400 hover:border-rose-500/30 transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
