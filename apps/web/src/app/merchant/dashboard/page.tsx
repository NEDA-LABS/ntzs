'use client';

import { useState, useEffect } from 'react';
import { useMerchant } from './layout';
import Link from 'next/link';
import { Copy, Share2, TrendingUp, Clock, Zap, Link2 } from 'lucide-react';

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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/merchant/api/merchant/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});

    fetch('/merchant/api/merchant/collections?limit=8')
      .then((r) => r.json())
      .then((d) => setCollections(d.items ?? []))
      .catch(() => {});
  }, []);

  const payUrl = merchant ? `${typeof window !== 'undefined' ? window.location.origin : ''}/m/${merchant.handle}` : '';

  function copyLink() {
    navigator.clipboard.writeText(payUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function shareWhatsApp() {
    const text = encodeURIComponent(`Pay me via nTZS: ${payUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  if (!merchant) return null;

  const STATS = [
    { label: 'Total Collected', value: stats ? `${formatTzs(stats.totalCollected)} TZS` : '—', icon: TrendingUp, index: '01' },
    { label: 'This Month', value: stats ? `${formatTzs(stats.thisMonth)} TZS` : '—', icon: TrendingUp, index: '02' },
    { label: 'Today', value: stats ? `${formatTzs(stats.today)} TZS` : '—', icon: Zap, index: '03' },
    { label: 'Pending', value: stats ? `${formatTzs(stats.pending)} TZS` : '—', icon: Clock, index: '04' },
    { label: 'Auto-Settled', value: stats ? `${formatTzs(stats.totalSettled)} TZS` : '—', icon: Zap, index: '05' },
    { label: 'Active Links', value: stats ? String(stats.activeLinks) : '—', icon: Link2, index: '06' },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto font-mono">

      {/* Section label */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-4 h-px bg-emerald-400/60" />
        <span className="text-[10px] tracking-widest text-white/30 uppercase">Dashboard / Overview</span>
        <div className="flex-1 h-px bg-white/5" />
      </div>

      {/* Payment link card */}
      <div className="relative mb-6 border border-emerald-500/20 bg-emerald-500/[0.03] p-5">
        <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-emerald-500/40" />
        <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-emerald-500/40" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-emerald-500/40" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-emerald-500/40" />

        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] tracking-widest text-emerald-500/60 uppercase">Payment Link</span>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] tracking-widest text-emerald-400/70 uppercase">Active</span>
          </div>
        </div>
        <p className="text-lg font-bold text-white tracking-wider mb-0.5">@{merchant.handle}</p>
        <p className="text-xs text-white/25 mb-4 truncate">{payUrl}</p>
        <div className="flex gap-2">
          <button
            onClick={copyLink}
            className="flex-1 flex items-center justify-center gap-2 border border-white/10 py-2.5 text-xs tracking-wider text-white/50 uppercase transition-colors hover:bg-white/5 hover:text-white/70"
          >
            <Copy size={11} />
            {copied ? 'Copied' : 'Copy Link'}
          </button>
          <button
            onClick={shareWhatsApp}
            className="flex-1 flex items-center justify-center gap-2 border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-xs tracking-wider text-emerald-400 uppercase transition-colors hover:bg-emerald-500/20"
          >
            <Share2 size={11} />
            Share via WhatsApp
          </button>
        </div>
      </div>

      {/* Settlement accumulating banner */}
      {stats && stats.settlementPendingTzs > 0 && merchant.settlePct > 0 && (
        <div className="mb-5 border border-amber-500/20 bg-amber-500/[0.03] px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-widest text-amber-400/70 uppercase mb-1">Settlement Accumulating</p>
            <p className="text-xs text-white/30">
              Building toward the 5,000 TZS payout threshold
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-amber-400">{formatTzs(stats.settlementPendingTzs)} TZS</p>
            <p className="text-[10px] text-white/25 mt-0.5">
              {Math.round((stats.settlementPendingTzs / 5000) * 100)}% of threshold
            </p>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {STATS.map(({ label, value, index }) => (
          <div key={label} className="relative border border-white/5 bg-white/[0.02] p-4">
            <span className="text-[9px] text-white/15 mb-2 block tracking-widest">{index}</span>
            <p className="text-[10px] tracking-widest text-white/35 uppercase mb-2">{label}</p>
            <p className="text-lg font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Recent collections */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-3 h-px bg-white/20" />
            <span className="text-[10px] tracking-widest text-white/40 uppercase">Recent Collections</span>
          </div>
          <Link href="/merchant/dashboard/collections" className="text-[10px] tracking-widest text-emerald-400/70 uppercase hover:text-emerald-400 transition-colors">
            View All
          </Link>
        </div>

        {collections.length === 0 ? (
          <div className="border border-white/5 p-10 text-center">
            <p className="text-xs text-white/30 tracking-wide">No collections yet</p>
            <p className="mt-1 text-[10px] text-white/15">Share your payment link to start collecting</p>
          </div>
        ) : (
          <div className="border border-white/5 divide-y divide-white/[0.04]">
            {collections.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center border border-white/10 text-[10px] font-bold text-white/40">
                    {(c.payerName || 'A')[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-white/80">{c.payerName || 'Anonymous'}</p>
                    <p className="text-[10px] text-white/25 tracking-wide">{timeAgo(c.createdAt)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-emerald-400">+{c.amountTzs.toLocaleString()} TZS</p>
                  <p className={`text-[10px] tracking-wide mt-0.5 ${
                    c.collectionStatus === 'minted' ? 'text-emerald-500/60' :
                    c.collectionStatus === 'failed' ? 'text-rose-400/60' : 'text-white/25'
                  }`}>
                    {c.collectionStatus === 'minted' ? 'Received' : c.collectionStatus === 'failed' ? 'Failed' : 'Pending'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
