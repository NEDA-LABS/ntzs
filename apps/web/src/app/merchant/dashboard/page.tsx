'use client';

import { useState, useEffect } from 'react';
import { useMerchant } from './layout';
import Link from 'next/link';
import { Copy, Share2, Plus, MessageCircle, ArrowRight, Package } from 'lucide-react';
import { OnboardingTips } from './_components/OnboardingTips';

interface Stats {
  totalCollected: number;
  totalSettled: number;
  settlementPendingTzs: number;
  today: number;
  thisMonth: number;
  pending: number;
  activeLinks: number;
}

interface Collection {
  id: string;
  amountTzs: number;
  payerName: string | null;
  payerPhone: string | null;
  collectionStatus: string;
  settlementStatus: string;
  settlementAmountTzs: number | null;
  createdAt: string;
}

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

function useCountUp(target: number | null, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === null) return;
    if (target === 0) { setValue(0); return; }
    let raf: number;
    const start = Date.now();
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1);
      setValue(Math.round((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function formatTzs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function MerchantOverviewPage() {
  const { merchant } = useMerchant();
  const [stats, setStats] = useState<Stats | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [links, setLinks] = useState<PayLink[]>([]);
  const [copied, setCopied] = useState(false);

  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const payUrl = merchant ? `${base}/m/${merchant.handle}` : '';

  useEffect(() => {
    fetch('/merchant/api/merchant/stats').then(r => r.json()).then(setStats).catch(() => {});
    fetch('/merchant/api/merchant/collections?limit=5').then(r => r.json()).then(d => setCollections(d.items ?? [])).catch(() => {});
    fetch('/merchant/api/merchant/links').then(r => r.json()).then(d => setLinks(d.links ?? [])).catch(() => {});
  }, []);

  function copyLink() {
    navigator.clipboard.writeText(payUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function shareStore() {
    const text = encodeURIComponent(`Nunua kupitia duka langu la nTZS: ${payUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  const totalCount  = useCountUp(stats?.totalCollected ?? null);
  const monthCount  = useCountUp(stats?.thisMonth ?? null);
  const todayCount  = useCountUp(stats?.today ?? null);

  if (!merchant) return null;

  const activeLinks = links.filter(l => l.isActive);

  return (
    <div className="p-5 lg:p-7 max-w-3xl mx-auto font-mono space-y-5">
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-7px); }
        }
        @keyframes shimmer {
          0%   { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }
        .anim-1 { animation: fadeUp 0.45s ease-out 0.05s both; }
        .anim-2 { animation: fadeUp 0.45s ease-out 0.12s both; }
        .anim-3 { animation: fadeUp 0.45s ease-out 0.20s both; }
        .anim-4 { animation: fadeUp 0.45s ease-out 0.28s both; }
        .anim-5 { animation: fadeUp 0.45s ease-out 0.36s both; }
        .anim-float { animation: float 3.5s ease-in-out infinite; }
        .stat-shimmer {
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%);
          background-size: 400px 100%;
          animation: shimmer 1.6s ease-in-out infinite;
          border-radius: 2px;
        }
        .card-enter { animation: scaleIn 0.35s ease-out both; }
      `}</style>

      {/* Breadcrumb */}
      <div className="anim-1 flex items-center gap-3">
        <div className="w-4 h-px bg-emerald-400/60" />
        <span className="text-[10px] tracking-widest text-white/40 uppercase">Dashboard / Overview</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      {/* ── STORE CARD ── */}
      <div className="anim-2 relative overflow-hidden border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.07] via-transparent to-transparent">
        <div className="absolute top-0 left-0 w-5 h-5 border-t border-l border-emerald-500/50" />
        <div className="absolute top-0 right-0 w-5 h-5 border-t border-r border-emerald-500/50" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-b border-l border-emerald-500/50" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-b border-r border-emerald-500/50" />

        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-[10px] tracking-widest text-emerald-400/70 uppercase mb-2">Your Store</p>
              <h2 className="text-2xl font-bold tracking-wider text-white leading-none">
                @{merchant.handle}
              </h2>
              {merchant.businessName && (
                <p className="text-xs text-white/50 tracking-wide mt-1">{merchant.businessName}</p>
              )}
              <p className="text-[10px] text-white/30 mt-1.5 truncate max-w-[220px]">{payUrl}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] tracking-widest text-emerald-400/80 uppercase">Active</span>
            </div>
          </div>

          {/* Balance — hero number */}
          <div className="mb-5">
            <p className="text-[10px] tracking-widest text-white/40 uppercase mb-2">Total Collected</p>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold text-white tabular-nums leading-none">
                {stats ? formatTzs(totalCount) : (
                  <span className="inline-block w-24 h-10 stat-shimmer" />
                )}
              </span>
              <span className="text-xl text-white/40 font-medium">TZS</span>
            </div>
            {stats && stats.pending > 0 && (
              <p className="text-xs text-amber-400/70 mt-2 tracking-wide">
                + {formatTzs(stats.pending)} TZS incoming
              </p>
            )}
          </div>

          {/* Sub-stats strip */}
          <div className="flex items-center border-t border-white/10 pt-4 mb-5">
            <div className="flex-1">
              <p className="text-[10px] tracking-widest text-white/40 uppercase mb-1">This Month</p>
              <p className="text-sm font-bold text-white/70 tabular-nums">
                {stats ? `${formatTzs(monthCount)} TZS` : <span className="inline-block w-16 h-4 stat-shimmer" />}
              </p>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="flex-1 px-4">
              <p className="text-[10px] tracking-widest text-white/40 uppercase mb-1">Today</p>
              <p className="text-sm font-bold text-white/70 tabular-nums">
                {stats ? `${formatTzs(todayCount)} TZS` : <span className="inline-block w-12 h-4 stat-shimmer" />}
              </p>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="flex-1 pl-4">
              <p className="text-[10px] tracking-widest text-white/40 uppercase mb-1">Products</p>
              <p className="text-sm font-bold text-white/70 tabular-nums">
                {stats ? stats.activeLinks : <span className="inline-block w-8 h-4 stat-shimmer" />} active
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={copyLink}
              className="flex-1 flex items-center justify-center gap-2 border border-white/15 py-3 text-xs tracking-wider text-white/60 uppercase transition-colors hover:bg-white/5 hover:text-white/80"
            >
              <Copy size={12} />
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <button
              onClick={shareStore}
              className="flex-1 flex items-center justify-center gap-2 border border-emerald-500/40 bg-emerald-500/10 py-3 text-xs tracking-wider text-emerald-400 uppercase transition-colors hover:bg-emerald-500/20"
            >
              <MessageCircle size={12} />
              Share Store
            </button>
          </div>
        </div>
      </div>

      {/* Settlement banner */}
      {stats && stats.settlementPendingTzs > 0 && merchant.settlePct > 0 && (
        <div className="anim-3 border border-amber-500/25 bg-amber-500/[0.04] px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-widest text-amber-400/80 uppercase mb-1">Settlement Accumulating</p>
            <p className="text-xs text-white/50">Building toward the 5,000 TZS payout threshold</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-amber-400">{formatTzs(stats.settlementPendingTzs)} TZS</p>
            <p className="text-[10px] text-white/40 mt-0.5">
              {Math.round((stats.settlementPendingTzs / 5000) * 100)}% of threshold
            </p>
          </div>
        </div>
      )}

      {/* ── PRODUCTS SHELF ── */}
      <div className="anim-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-3 h-px bg-emerald-400/50" />
            <span className="text-[10px] tracking-widest text-white/50 uppercase">Your Products</span>
          </div>
          <div className="flex items-center gap-2">
            <OnboardingTips autoOpen={activeLinks.length === 0 && collections.length === 0} />
            {activeLinks.length > 0 && (
              <Link
                href="/merchant/dashboard/links"
                className="text-[10px] tracking-widest text-white/35 uppercase hover:text-white/60 transition-colors"
              >
                Manage
              </Link>
            )}
            <Link
              href="/merchant/dashboard/links?new=1"
              className="flex items-center gap-1.5 border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-[10px] tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 transition-colors"
            >
              <Plus size={10} />
              Add Product
            </Link>
          </div>
        </div>

        {activeLinks.length === 0 ? (
          <Link
            href="/merchant/dashboard/links?new=1"
            className="group flex flex-col items-center justify-center border border-dashed border-white/15 hover:border-emerald-500/30 py-14 transition-all"
          >
            <div className="flex h-11 w-11 items-center justify-center border border-white/15 group-hover:border-emerald-500/30 mb-3 transition-colors">
              <Package size={18} className="anim-float text-white/30 group-hover:text-emerald-400/60 transition-colors" />
            </div>
            <p className="text-sm text-white/40 tracking-wide">No products yet</p>
            <p className="mt-1 text-xs text-white/30">Add a product or service to start selling</p>
            <div className="flex items-center gap-1.5 mt-4 text-[10px] text-emerald-400/60 tracking-widest uppercase group-hover:text-emerald-400 transition-colors">
              <Plus size={10} />
              Add your first product
            </div>
          </Link>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {activeLinks.slice(0, 6).map((link, i) => (
              <ProductCard
                key={link.id}
                link={link}
                index={i}
                url={`${base}/m/${merchant.handle}?link=${link.id}`}
              />
            ))}
            {activeLinks.length > 6 && (
              <Link
                href="/merchant/dashboard/links"
                className="group flex flex-col items-center justify-center border border-white/10 hover:border-white/20 py-8 text-center transition-colors"
              >
                <span className="text-xl font-bold text-white/40 group-hover:text-white/60 transition-colors">
                  +{activeLinks.length - 6}
                </span>
                <span className="text-[10px] text-white/30 mt-1 tracking-wide uppercase">more</span>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* ── RECENT ORDERS ── */}
      <div className="anim-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-3 h-px bg-white/25" />
            <span className="text-[10px] tracking-widest text-white/50 uppercase">Recent Orders</span>
          </div>
          <Link
            href="/merchant/dashboard/collections"
            className="flex items-center gap-1 text-[10px] tracking-widest text-emerald-400/70 uppercase hover:text-emerald-400 transition-colors"
          >
            View All <ArrowRight size={10} />
          </Link>
        </div>

        {collections.length === 0 ? (
          <div className="border border-white/10 p-12 text-center">
            <p className="text-sm text-white/40 tracking-wide">No orders yet</p>
            <p className="mt-1.5 text-xs text-white/30">Share your store or a product link to get started</p>
          </div>
        ) : (
          <div className="border border-white/10 divide-y divide-white/[0.06]">
            {collections.map((c, i) => (
              <div key={c.id} className="card-enter flex items-center justify-between px-4 py-3.5 hover:bg-white/[0.03] transition-colors" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-white/15 bg-white/[0.04] text-xs font-bold text-white/50">
                    {(c.payerName || 'A')[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white/80">{c.payerName || 'Customer'}</p>
                    <p className="text-[10px] text-white/40 tracking-wide mt-0.5">{timeAgo(c.createdAt)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-emerald-400">+{c.amountTzs.toLocaleString()} TZS</p>
                  <div className="flex items-center justify-end gap-1.5 mt-0.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      c.collectionStatus === 'minted' ? 'bg-emerald-400' :
                      c.collectionStatus === 'failed' ? 'bg-rose-400' : 'bg-amber-400'
                    }`} />
                    <p className={`text-[10px] tracking-wide ${
                      c.collectionStatus === 'minted' ? 'text-emerald-400/70' :
                      c.collectionStatus === 'failed' ? 'text-rose-400/70' : 'text-amber-400/70'
                    }`}>
                      {c.collectionStatus === 'minted' ? 'Received' :
                       c.collectionStatus === 'failed' ? 'Failed' : 'Pending'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

function ProductCard({ link, url, index = 0 }: { link: PayLink; url: string; index?: number }) {
  const hasDiscount = link.discountPct > 0 && link.originalAmountTzs;
  const [sent, setSent] = useState(false);

  function sendWhatsApp(e: React.MouseEvent) {
    e.preventDefault();
    const name = link.productName || 'bidhaa yangu';
    const price = link.amountTzs ? ` — ${link.amountTzs.toLocaleString()} TZS` : '';
    const promo = hasDiscount ? ` (punguzo la ${link.discountPct}%!)` : '';
    window.open(`https://wa.me/?text=${encodeURIComponent(`${name}${price}${promo}\n${url}`)}`, '_blank');
    setSent(true);
    setTimeout(() => setSent(false), 2000);
  }

  return (
    <div className="card-enter group flex flex-col overflow-hidden border border-white/10 hover:border-white/20 bg-white/[0.03] transition-all" style={{ animationDelay: `${index * 70}ms` }}>
      {/* Thumbnail */}
      <div className="relative h-28 w-full overflow-hidden bg-white/[0.04] flex items-center justify-center shrink-0">
        {link.imageUrl ? (
          <img src={link.imageUrl} alt={link.productName ?? ''} className="w-full h-full object-cover" />
        ) : (
          <Package size={24} className="text-white/20" />
        )}
        {hasDiscount && (
          <div className="absolute top-2 left-2 bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-black">
            -{link.discountPct}%
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col flex-1 p-3">
        <p className="text-xs font-semibold text-white/80 truncate mb-1 leading-snug">
          {link.productName || 'Unnamed Product'}
        </p>

        {link.type === 'fixed' && link.amountTzs ? (
          <div className="flex items-baseline gap-1.5 mb-3">
            <span className="text-sm font-bold text-emerald-400 tabular-nums">
              {link.amountTzs.toLocaleString()}
            </span>
            <span className="text-[10px] text-white/40">TZS</span>
            {hasDiscount && (
              <span className="text-[10px] text-white/30 line-through">
                {link.originalAmountTzs!.toLocaleString()}
              </span>
            )}
          </div>
        ) : (
          <p className="text-[10px] text-white/40 tracking-wide mb-3">Customer sets amount</p>
        )}

        <button
          onClick={sendWhatsApp}
          className="mt-auto flex items-center justify-center gap-1.5 border border-emerald-500/30 bg-emerald-500/[0.08] py-2 text-[10px] tracking-widest text-emerald-400/80 uppercase hover:bg-emerald-500/20 hover:text-emerald-400 transition-colors"
        >
          {sent ? (
            'Sent!'
          ) : (
            <>
              <Share2 size={10} />
              Send
            </>
          )}
        </button>
      </div>
    </div>
  );
}
