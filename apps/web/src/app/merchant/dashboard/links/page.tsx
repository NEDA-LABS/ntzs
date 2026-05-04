'use client';

import { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useMerchant } from '../layout';
import {
  Copy, Plus, X, Trash2, Upload, Tag, Share2,
  MessageCircle, Send, ExternalLink, Package, ArrowRight,
  Play, Youtube, Music2, Instagram,
} from 'lucide-react';
import type { SocialPreview, SocialPlatform } from '@/app/api/merchant/social-preview/route';

interface PayLink {
  id: string;
  type: 'fixed' | 'open';
  productName: string | null;
  imageUrl: string | null;
  promoUrl: string | null;
  amountTzs: number | null;
  originalAmountTzs: number | null;
  discountPct: number;
  description: string | null;
  slug: string | null;
  isActive: boolean;
  createdAt: string;
}

/* ─── helpers ─── */
function fmtPrice(n: number) {
  return n.toLocaleString('en-US');
}

function isSocialUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return /youtube\.com|youtu\.be|tiktok\.com|instagram\.com/.test(h);
  } catch { return false; }
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram Reel',
  unknown: 'Video',
};

const PLATFORM_COLORS: Record<SocialPlatform, string> = {
  youtube:   'border-rose-500/30 bg-rose-500/[0.06] text-rose-400',
  tiktok:    'border-pink-500/30 bg-pink-500/[0.06] text-pink-400',
  instagram: 'border-purple-500/30 bg-purple-500/[0.06] text-purple-400',
  unknown:   'border-white/15 bg-white/[0.03] text-white/40',
};

function PlatformIcon({ platform, size = 12 }: { platform: SocialPlatform; size?: number }) {
  if (platform === 'youtube')   return <Youtube size={size} />;
  if (platform === 'tiktok')    return <Music2 size={size} />;
  if (platform === 'instagram') return <Instagram size={size} />;
  return <Play size={size} />;
}

/* ─── Live preview ─── */
function ProductPreview({
  name, imagePreview, type, amount, enableDiscount, discountPct, description, promoMeta,
}: {
  name: string; imagePreview: string; type: 'fixed' | 'open';
  amount: string; enableDiscount: boolean; discountPct: number; description: string;
  promoMeta: SocialPreview | null;
}) {
  const price = Number(amount);
  const discounted = enableDiscount && price > 0 ? Math.round(price * (1 - discountPct / 100)) : price;
  const hasContent = name || imagePreview || amount || promoMeta;

  return (
    <div className="border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] tracking-widest text-white/40 uppercase">Customer Preview</span>
      </div>

      {!hasContent ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Package size={28} className="text-white/15 mb-3" />
          <p className="text-xs text-white/25">Fill in the form to see a preview</p>
        </div>
      ) : (
        <div className="p-4">
          {/* Live iframe embed for YouTube / TikTok */}
          {promoMeta?.embedUrl ? (
            <div className="mb-4 overflow-hidden border border-white/10">
              <div className={`relative w-full ${promoMeta.platform === 'tiktok' ? 'h-[300px]' : 'aspect-video'}`}>
                <iframe
                  src={promoMeta.embedUrl}
                  className="absolute inset-0 w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
              <div className={`flex items-center gap-1.5 px-3 py-1.5 border-t border-white/10 text-[9px] tracking-widest uppercase ${PLATFORM_COLORS[promoMeta.platform]}`}>
                <PlatformIcon platform={promoMeta.platform} size={8} />
                {PLATFORM_LABELS[promoMeta.platform]} · Live Preview
              </div>
            </div>

          /* Instagram — can't embed, show thumbnail or static badge */
          ) : promoMeta ? (
            imagePreview ? (
              <div className="relative mb-4 overflow-hidden">
                <img src={imagePreview} alt="preview" className="w-full h-44 object-cover" />
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2">
                  <div className={`flex items-center gap-1.5 border px-3 py-1.5 text-[10px] tracking-widest uppercase backdrop-blur-sm ${PLATFORM_COLORS[promoMeta.platform]}`}>
                    <PlatformIcon platform={promoMeta.platform} size={10} />
                    {PLATFORM_LABELS[promoMeta.platform]}
                  </div>
                  <p className="text-[9px] text-white/50">Opens in Instagram</p>
                </div>
              </div>
            ) : (
              <div className="mb-4 h-28 flex items-center justify-center bg-white/[0.03] border border-dashed border-white/10">
                <div className="flex flex-col items-center gap-2">
                  <PlatformIcon platform={promoMeta.platform} size={18} />
                  <span className="text-[9px] text-white/30">Opens in Instagram</span>
                </div>
              </div>
            )

          /* Regular image (no promo) */
          ) : imagePreview ? (
            <div className="relative mb-4 overflow-hidden">
              <img src={imagePreview} alt="preview" className="w-full h-48 object-cover" />
              {enableDiscount && price > 0 && (
                <div className="absolute top-3 left-3 bg-emerald-500 px-2 py-1 text-[10px] font-bold text-black tracking-wide">
                  SAVE {discountPct}%
                </div>
              )}
            </div>

          /* Nothing yet */
          ) : (
            <div className="mb-4 h-32 flex items-center justify-center bg-white/[0.03] border border-dashed border-white/10">
              <Package size={24} className="text-white/20" />
            </div>
          )}

          {/* Discount badge sits outside iframe (for promo+discount combo) */}
          {promoMeta?.embedUrl && enableDiscount && price > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <div className="bg-emerald-500 px-2 py-1 text-[10px] font-bold text-black tracking-wide">SAVE {discountPct}%</div>
            </div>
          )}

          <p className="text-base font-bold text-white/90 mb-1 leading-snug">
            {name || <span className="text-white/25 font-normal italic">Product name…</span>}
          </p>

          {description && (
            <p className="text-xs text-white/45 mb-3 leading-relaxed">{description}</p>
          )}

          {type === 'fixed' && amount ? (
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-2xl font-bold text-emerald-400">{fmtPrice(discounted)}</span>
              <span className="text-sm text-white/40">TZS</span>
              {enableDiscount && price > 0 && (
                <span className="text-sm text-white/30 line-through">{fmtPrice(price)} TZS</span>
              )}
            </div>
          ) : type === 'open' ? (
            <p className="text-xs text-white/40 mb-4">Customer enters the amount</p>
          ) : null}

          <div className="flex items-center justify-center gap-2 border border-emerald-500/40 bg-emerald-500/10 py-3 text-xs font-medium tracking-widest text-emerald-400 uppercase">
            Pay Now <ArrowRight size={12} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Promo video preview card in the form ─── */
function PromoPreviewCard({ meta, rawUrl, onRemove }: { meta: SocialPreview; rawUrl: string; onRemove: () => void }) {
  const colorClass = PLATFORM_COLORS[meta.platform];
  return (
    <div className="relative border border-white/10 overflow-hidden">
      {/* Thumbnail */}
      {meta.thumbnail ? (
        <div className="relative h-44 w-full overflow-hidden">
          <img src={meta.thumbnail} alt="promo thumbnail" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 border border-white/25 backdrop-blur-sm">
              <Play size={20} className="text-white ml-1" />
            </div>
          </div>
          <div className={`absolute top-3 left-3 flex items-center gap-1.5 border px-2.5 py-1 text-[10px] font-semibold tracking-widest uppercase backdrop-blur-sm ${colorClass}`}>
            <PlatformIcon platform={meta.platform} size={10} />
            {PLATFORM_LABELS[meta.platform]}
          </div>
        </div>
      ) : (
        <div className="h-24 flex items-center justify-center bg-white/[0.03]">
          <div className="flex flex-col items-center gap-2">
            <div className={`flex items-center gap-2 border px-3 py-1.5 text-[10px] tracking-widest uppercase ${colorClass}`}>
              <PlatformIcon platform={meta.platform} size={11} />
              {PLATFORM_LABELS[meta.platform]}
            </div>
            {meta.platform === 'instagram' && (
              <p className="text-[10px] text-white/30">Preview not available — will embed on product page</p>
            )}
          </div>
        </div>
      )}

      {/* Info row */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-white/10">
        <div className="flex-1 min-w-0">
          {meta.title && <p className="text-[11px] text-white/60 truncate mb-0.5">{meta.title}</p>}
          <p className="text-[10px] text-white/30 truncate">{rawUrl}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={rawUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] tracking-widest text-white/30 uppercase hover:text-white/60 transition-colors flex items-center gap-1"
          >
            <ExternalLink size={10} /> Open
          </a>
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1.5 border border-white/15 bg-black/50 px-3 py-1.5 text-[10px] text-white/50 uppercase hover:text-white transition-colors backdrop-blur-sm"
          >
            <X size={10} /> Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main page (inner, needs Suspense for useSearchParams) ─── */
function LinksPageInner() {
  const { merchant } = useMerchant();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [links, setLinks] = useState<PayLink[]>([]);
  const [showForm, setShowForm] = useState(false);

  /* form state */
  const [type, setType] = useState<'fixed' | 'open'>('fixed');
  const [productName, setProductName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [promoUrl, setPromoUrl] = useState('');
  const [promoMeta, setPromoMeta] = useState<SocialPreview | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [mediaInput, setMediaInput] = useState('');
  const [amount, setAmount] = useState('');
  const [enableDiscount, setEnableDiscount] = useState(false);
  const [discountPct, setDiscountPct] = useState(10);
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const base = typeof window !== 'undefined' ? window.location.origin : '';

  /* auto-open when navigating here with ?new=1 */
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowForm(true);
      router.replace('/merchant/dashboard/links', { scroll: false });
      setTimeout(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadLinks() {
    const res = await fetch('/merchant/api/merchant/links');
    const data = await res.json();
    setLinks(data.links ?? []);
  }

  useEffect(() => { loadLinks(); }, []);

  function openForm() {
    setShowForm(true);
    resetForm();
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setImagePreview(url);
      setImageUrl(url);
      setPromoUrl('');
      setPromoMeta(null);
      setMediaInput('');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  const resolveMediaUrl = useCallback(async (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;

    if (isSocialUrl(trimmed)) {
      setPromoLoading(true);
      try {
        const res = await fetch(`/api/merchant/social-preview?url=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const meta: SocialPreview = await res.json();
          setPromoUrl(trimmed);
          setPromoMeta(meta);
          if (meta.thumbnail) {
            setImageUrl(meta.thumbnail);
            setImagePreview(meta.thumbnail);
          } else {
            setImageUrl('');
            setImagePreview('');
          }
        }
      } finally {
        setPromoLoading(false);
      }
    } else {
      // Treat as image URL
      setImageUrl(trimmed);
      setImagePreview(trimmed);
      setPromoUrl('');
      setPromoMeta(null);
    }
  }, []);

  function handleMediaInputChange(val: string) {
    setMediaInput(val);
  }

  function handleMediaInputBlur() {
    if (mediaInput.trim()) resolveMediaUrl(mediaInput);
  }

  function handleMediaInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (mediaInput.trim()) resolveMediaUrl(mediaInput);
    }
  }

  function clearMedia() {
    setImageUrl('');
    setImagePreview('');
    setPromoUrl('');
    setPromoMeta(null);
    setMediaInput('');
  }

  function resetForm() {
    setType('fixed');
    setProductName('');
    setImageUrl('');
    setImagePreview('');
    setPromoUrl('');
    setPromoMeta(null);
    setMediaInput('');
    setAmount('');
    setEnableDiscount(false);
    setDiscountPct(10);
    setDescription('');
    setFormError('');
    setPromoLoading(false);
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
          promoUrl: promoUrl || undefined,
          amountTzs: type === 'fixed' && !enableDiscount ? Number(amount) : undefined,
          originalAmountTzs: type === 'fixed' && enableDiscount ? Number(amount) : undefined,
          discountPct: enableDiscount ? discountPct : 0,
          description: description || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setFormError(d.error || 'Failed to create product');
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
    return `${base}/m/${merchant?.handle ?? ''}?link=${link.id}`;
  }

  function copyLink(link: PayLink) {
    navigator.clipboard.writeText(linkUrl(link)).then(() => {
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  // has any media set (photo OR promo video)
  const hasMedia = !!(imagePreview || promoMeta);

  return (
    <div className="p-5 lg:p-7 max-w-2xl mx-auto font-mono">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-4 h-px bg-emerald-400/60" />
          <span className="text-[10px] tracking-widest text-white/40 uppercase">Dashboard / Products</span>
        </div>
        {!showForm && (
          <button
            onClick={openForm}
            className="flex items-center gap-2 border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-[10px] tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 transition-colors"
          >
            <Plus size={11} />
            New Product
          </button>
        )}
      </div>

      {/* ── PRODUCT FORM ── */}
      {showForm && (
        <div ref={formRef} className="mb-8">
          <form onSubmit={createLink}>
            {/* Form header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-3 h-px bg-emerald-400/60" />
                <span className="text-xs font-semibold tracking-widest text-white/60 uppercase">New Product</span>
              </div>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="flex items-center gap-1.5 text-[10px] tracking-widest text-white/35 uppercase hover:text-white/60 transition-colors"
              >
                <X size={13} /> Cancel
              </button>
            </div>

            {/* Two-col on desktop: form | preview */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5 items-start">

              {/* ── Left: form fields ── */}
              <div className="space-y-5">

                {/* Media: photo upload OR social link */}
                <div>
                  <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
                    Product Photo or Promo Video
                  </label>

                  {/* Has image from upload (not social) */}
                  {imagePreview && !promoMeta ? (
                    <div className="relative border border-white/10 overflow-hidden">
                      <img src={imagePreview} alt="preview" className="w-full h-52 object-cover" />
                      <button
                        type="button"
                        onClick={clearMedia}
                        className="absolute top-3 right-3 flex items-center gap-1.5 border border-white/20 bg-black/80 px-3 py-1.5 text-[10px] text-white/60 hover:text-white transition-colors backdrop-blur-sm"
                      >
                        <X size={11} /> Remove
                      </button>
                    </div>

                  /* Has promo video */
                  ) : promoMeta ? (
                    <PromoPreviewCard meta={promoMeta} rawUrl={promoUrl} onRemove={clearMedia} />

                  /* Empty state — upload or paste */
                  ) : (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="group flex flex-col items-center justify-center w-full border border-dashed border-white/20 hover:border-emerald-500/40 bg-white/[0.02] hover:bg-emerald-500/[0.03] py-10 transition-all"
                      >
                        <div className="flex h-12 w-12 items-center justify-center border border-white/15 group-hover:border-emerald-500/30 mb-3 transition-colors">
                          <Upload size={18} className="text-white/30 group-hover:text-emerald-400/60 transition-colors" />
                        </div>
                        <p className="text-sm text-white/50 group-hover:text-white/70 transition-colors">Upload product photo</p>
                        <p className="mt-1 text-[10px] text-white/30">Click to browse · JPG, PNG, WEBP</p>
                      </button>

                      {/* Divider */}
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-white/10" />
                        <span className="text-[10px] text-white/30">or paste a link</span>
                        <div className="flex-1 h-px bg-white/10" />
                      </div>

                      {/* Smart URL input */}
                      <div className="relative">
                        <input
                          type="url"
                          placeholder="Photo URL, TikTok Reel, Instagram Reel, or YouTube…"
                          value={mediaInput}
                          onChange={(e) => handleMediaInputChange(e.target.value)}
                          onBlur={handleMediaInputBlur}
                          onKeyDown={handleMediaInputKeyDown}
                          className="w-full border border-white/15 bg-black px-4 py-3 pr-20 text-sm text-white placeholder:text-white/25 focus:border-emerald-500/50 focus:outline-none"
                        />
                        {promoLoading && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                            <div className="w-1 h-1 rounded-full bg-white/40 animate-bounce [animation-delay:0ms]" />
                            <div className="w-1 h-1 rounded-full bg-white/40 animate-bounce [animation-delay:150ms]" />
                            <div className="w-1 h-1 rounded-full bg-white/40 animate-bounce [animation-delay:300ms]" />
                          </div>
                        )}
                        {!promoLoading && mediaInput && (
                          <button
                            type="button"
                            onClick={() => resolveMediaUrl(mediaInput)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] tracking-widest text-emerald-400/70 uppercase hover:text-emerald-400 transition-colors"
                          >
                            Go →
                          </button>
                        )}
                      </div>

                      {/* Platform hints */}
                      <div className="flex items-center gap-2 flex-wrap pt-0.5">
                        <span className="text-[9px] text-white/20 tracking-wider uppercase">Accepts:</span>
                        {(['tiktok', 'instagram', 'youtube'] as SocialPlatform[]).map((p) => (
                          <span key={p} className={`flex items-center gap-1 border px-2 py-0.5 text-[9px] tracking-widest uppercase ${PLATFORM_COLORS[p]}`}>
                            <PlatformIcon platform={p} size={8} />
                            {PLATFORM_LABELS[p]}
                          </span>
                        ))}
                        <span className="text-[9px] text-white/20">· image URLs</span>
                      </div>
                    </div>
                  )}

                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
                </div>

                {/* Product name */}
                <div>
                  <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
                    Product Name
                  </label>
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="e.g. Summer Dress, Invoice #42, Event Ticket…"
                    className="w-full border border-white/15 bg-black px-4 py-3.5 text-sm text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none transition-colors"
                  />
                </div>

                {/* Pricing type */}
                <div>
                  <label className="mb-2.5 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
                    Pricing Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['fixed', 'open'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className={`flex flex-col items-start gap-1 px-4 py-3.5 border text-left transition-colors ${
                          type === t
                            ? 'border-emerald-500/50 bg-emerald-500/[0.08] text-emerald-400'
                            : 'border-white/15 text-white/40 hover:border-white/25 hover:bg-white/[0.02]'
                        }`}
                      >
                        <span className="text-xs font-semibold tracking-wide">
                          {t === 'fixed' ? 'Fixed Price' : 'Open Amount'}
                        </span>
                        <span className={`text-[10px] ${type === t ? 'text-emerald-400/60' : 'text-white/30'}`}>
                          {t === 'fixed' ? 'You set the price' : 'Customer decides'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Price input */}
                {type === 'fixed' && (
                  <div>
                    <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
                      {enableDiscount ? 'Original Price' : 'Price'}
                    </label>
                    <div className="flex">
                      <div className="flex items-center px-4 border border-r-0 border-white/15 bg-white/[0.04]">
                        <span className="text-sm font-semibold text-white/50 tracking-widest">TZS</span>
                      </div>
                      <input
                        type="number"
                        required
                        min={100}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="25,000"
                        className="flex-1 border border-white/15 bg-black px-4 py-3.5 text-lg font-bold text-white placeholder:text-white/20 focus:border-emerald-500/50 focus:outline-none tabular-nums transition-colors"
                      />
                    </div>
                  </div>
                )}

                {/* Discount */}
                {type === 'fixed' && (
                  <div className="border border-white/10 bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Tag size={12} className="text-white/40" />
                        <span className="text-[10px] font-medium tracking-widest text-white/50 uppercase">Promo Discount</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEnableDiscount(!enableDiscount)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          enableDiscount ? 'bg-emerald-500' : 'bg-white/15'
                        }`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          enableDiscount ? 'translate-x-4.5' : 'translate-x-0.5'
                        }`} />
                      </button>
                    </div>

                    {enableDiscount && (
                      <div className="mt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-white/50">Discount amount</span>
                          <span className="text-lg font-bold text-emerald-400">{discountPct}% off</span>
                        </div>
                        <input
                          type="range" min={5} max={90} step={5}
                          value={discountPct}
                          onChange={(e) => setDiscountPct(Number(e.target.value))}
                          className="w-full accent-emerald-500"
                        />
                        {amount && discountedAmount >= 100 && (
                          <div className="flex items-center justify-between border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-3">
                            <div>
                              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-0.5">Customer pays</p>
                              <p className="text-xl font-bold text-emerald-400">{fmtPrice(discountedAmount)} TZS</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-0.5">Was</p>
                              <p className="text-sm text-white/40 line-through">{fmtPrice(Number(amount))} TZS</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Description */}
                <div>
                  <label className="mb-2 block text-[10px] font-medium tracking-widest text-white/50 uppercase">
                    Description <span className="text-white/25 normal-case tracking-normal font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Any extra details for the buyer — size, colour, delivery info…"
                    rows={3}
                    className="w-full border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none resize-none transition-colors"
                  />
                </div>

                {formError && (
                  <p className="border border-rose-500/25 bg-rose-500/[0.05] px-4 py-3 text-xs text-rose-300">{formError}</p>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={creating}
                  className="w-full flex items-center justify-center gap-2 border border-emerald-500/50 bg-emerald-500/15 py-4 text-sm font-semibold tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {creating ? (
                    'Creating…'
                  ) : (
                    <>
                      Create Product <ArrowRight size={14} />
                    </>
                  )}
                </button>
              </div>

              {/* ── Right: live preview (desktop only) ── */}
              <div className="hidden lg:block sticky top-6">
                <p className="text-[10px] font-medium tracking-widest text-white/40 uppercase mb-2">Live Preview</p>
                <ProductPreview
                  name={productName}
                  imagePreview={imagePreview}
                  type={type}
                  amount={amount}
                  enableDiscount={enableDiscount}
                  discountPct={discountPct}
                  description={description}
                  promoMeta={promoMeta}
                />
              </div>
            </div>

            {/* Mobile preview (below form) */}
            <div className="mt-5 lg:hidden">
              <p className="text-[10px] font-medium tracking-widest text-white/40 uppercase mb-2">Live Preview</p>
              <ProductPreview
                name={productName}
                imagePreview={imagePreview}
                type={type}
                amount={amount}
                enableDiscount={enableDiscount}
                discountPct={discountPct}
                description={description}
                promoMeta={promoMeta}
              />
            </div>
          </form>
        </div>
      )}

      {/* ── PRODUCT LIST ── */}
      {links.length === 0 && !showForm ? (
        <div className="border border-dashed border-white/15 p-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center border border-white/15 mx-auto mb-3">
            <Package size={20} className="text-white/30" />
          </div>
          <p className="text-sm text-white/50 tracking-wide">No products yet</p>
          <p className="mt-1.5 text-xs text-white/35">Create a product with an image, name, and price</p>
          <button
            onClick={openForm}
            className="mt-6 flex items-center gap-2 border border-emerald-500/35 bg-emerald-500/10 px-5 py-2.5 text-[10px] tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 transition-colors mx-auto"
          >
            <Plus size={10} />
            Add your first product
          </button>
        </div>
      ) : links.length > 0 ? (
        <div>
          {showForm && <div className="h-px bg-white/10 mb-6" />}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-px bg-white/20" />
            <span className="text-[10px] tracking-widest text-white/40 uppercase">
              {links.length} product{links.length !== 1 ? 's' : ''}
            </span>
          </div>
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
        </div>
      ) : null}
    </div>
  );
}

/* ─── Suspense wrapper required for useSearchParams in Next.js ─── */
export default function LinksPage() {
  return (
    <Suspense fallback={null}>
      <LinksPageInner />
    </Suspense>
  );
}

/* ─── Product card in the list ─── */
function ProductLinkCard({
  link, url, copied, onCopy, onDelete,
}: {
  link: PayLink; url: string; copied: boolean; onCopy: () => void; onDelete: () => void;
}) {
  const hasDiscount = link.discountPct > 0 && link.originalAmountTzs;
  const [shareOpen, setShareOpen] = useState(false);

  const promoplatform: SocialPlatform | null = link.promoUrl
    ? /tiktok/.test(link.promoUrl) ? 'tiktok'
    : /instagram/.test(link.promoUrl) ? 'instagram'
    : /youtube|youtu\.be/.test(link.promoUrl) ? 'youtube'
    : null
  : null;

  const shareText = link.productName
    ? `${link.productName}${link.amountTzs ? ` — ${link.amountTzs.toLocaleString()} TZS` : ''}${hasDiscount ? ` (${link.discountPct}% off!)` : ''}`
    : 'Pay via nTZS Biashara';

  function shareWhatsApp() { window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${url}`)}`, '_blank'); setShareOpen(false); }
  function shareTelegram()  { window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`, '_blank'); setShareOpen(false); }
  function shareTwitter()   { window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${shareText} ${url}`)}`, '_blank'); setShareOpen(false); }
  async function shareNative() {
    if (navigator.share) { try { await navigator.share({ title: shareText, url }); } catch { /* cancelled */ } }
    setShareOpen(false);
  }

  return (
    <div className="border border-white/10 bg-white/[0.02] overflow-hidden">
      {link.imageUrl && (
        <div className="relative h-36 w-full overflow-hidden border-b border-white/10">
          <img src={link.imageUrl} alt={link.productName ?? ''} className="w-full h-full object-cover" />
          {hasDiscount && (
            <div className="absolute top-2 left-2 bg-emerald-500 px-2 py-0.5 text-[10px] font-bold tracking-widest text-black uppercase">
              Save {link.discountPct}%
            </div>
          )}
          {promoplatform && (
            <div className={`absolute top-2 right-2 flex items-center gap-1 border px-2 py-0.5 text-[9px] tracking-widest uppercase backdrop-blur-sm ${PLATFORM_COLORS[promoplatform]}`}>
              <PlatformIcon platform={promoplatform} size={8} />
              <Play size={8} />
            </div>
          )}
          {link.type === 'open' && !promoplatform && (
            <div className="absolute top-2 right-2 border border-white/25 bg-black/70 px-2 py-0.5 text-[10px] tracking-widest text-white/60 uppercase backdrop-blur-sm">
              Open
            </div>
          )}
        </div>
      )}

      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {link.productName && (
                <p className="text-sm font-semibold text-white/90 truncate">{link.productName}</p>
              )}
              {!link.imageUrl && link.type === 'open' && (
                <span className="border border-white/15 px-2 py-0.5 text-[10px] tracking-widest text-white/50 uppercase">Open</span>
              )}
              {!link.isActive && (
                <span className="border border-white/15 px-2 py-0.5 text-[10px] tracking-widest text-white/40 uppercase">Inactive</span>
              )}
            </div>

            {link.type === 'fixed' && link.amountTzs && (
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-base font-bold text-emerald-400">{link.amountTzs.toLocaleString()} TZS</span>
                {hasDiscount && (
                  <span className="text-xs text-white/40 line-through">{link.originalAmountTzs!.toLocaleString()} TZS</span>
                )}
              </div>
            )}

            {link.description && (
              <p className="text-xs text-white/50 line-clamp-2 mb-1">{link.description}</p>
            )}
            <p className="text-[10px] text-white/30 truncate mt-0.5">{url}</p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onCopy}
              className="border border-white/15 px-3 py-1.5 text-[10px] tracking-wider text-white/45 uppercase hover:bg-white/[0.04] hover:text-white/70 transition-colors flex items-center gap-1.5"
            >
              <Copy size={10} />
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => setShareOpen(o => !o)}
              className={`border px-3 py-1.5 text-[10px] tracking-wider uppercase transition-colors flex items-center gap-1.5 ${
                shareOpen
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                  : 'border-white/15 text-white/45 hover:bg-white/[0.04] hover:text-white/70'
              }`}
            >
              <Share2 size={10} />
              Share
            </button>
            <button
              onClick={onDelete}
              className="border border-white/15 p-1.5 text-white/30 hover:text-rose-400 hover:border-rose-500/40 transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>

      {shareOpen && (
        <div className="border-t border-white/10 bg-white/[0.02] px-4 py-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] tracking-widest text-white/30 uppercase mr-1">Share via</span>
          <button onClick={shareWhatsApp} className="flex items-center gap-1.5 border border-green-500/25 bg-green-500/[0.06] px-3 py-1.5 text-[10px] tracking-wider text-green-400 uppercase hover:bg-green-500/15 transition-colors">
            <MessageCircle size={10} /> WhatsApp
          </button>
          <button onClick={shareTelegram} className="flex items-center gap-1.5 border border-sky-500/25 bg-sky-500/[0.06] px-3 py-1.5 text-[10px] tracking-wider text-sky-400 uppercase hover:bg-sky-500/15 transition-colors">
            <Send size={10} /> Telegram
          </button>
          <button onClick={shareTwitter} className="flex items-center gap-1.5 border border-white/15 px-3 py-1.5 text-[10px] tracking-wider text-white/45 uppercase hover:bg-white/[0.04] hover:text-white/70 transition-colors">
            <ExternalLink size={10} /> X
          </button>
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button onClick={shareNative} className="flex items-center gap-1.5 border border-white/15 px-3 py-1.5 text-[10px] tracking-wider text-white/45 uppercase hover:bg-white/[0.04] hover:text-white/70 transition-colors">
              <Share2 size={10} /> More
            </button>
          )}
        </div>
      )}
    </div>
  );
}
