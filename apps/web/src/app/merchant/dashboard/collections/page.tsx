'use client';

import { useState, useEffect } from 'react';

interface Collection {
  id: string;
  amountTzs: number;
  payerName: string | null;
  payerPhone: string | null;
  collectionStatus: string;
  settlementStatus: string;
  settlementAmountTzs: number | null;
  settlePct: number;
  createdAt: string;
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

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  minted:  { label: 'Received',  className: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5' },
  pending: { label: 'Pending',   className: 'text-amber-400 border-amber-500/20 bg-amber-500/5' },
  failed:  { label: 'Failed',    className: 'text-rose-400 border-rose-500/20 bg-rose-500/5' },
};

const SETTLE_CONFIG: Record<string, { label: string; className: string }> = {
  completed:  { label: 'Settled',      className: 'text-emerald-400' },
  queued:     { label: 'Accumulating', className: 'text-amber-400' },
  processing: { label: 'Paying Out',   className: 'text-blue-400' },
  failed:     { label: 'Failed',       className: 'text-rose-400' },
  skipped:    { label: '--',           className: 'text-white/20' },
  pending:    { label: '--',           className: 'text-white/20' },
};

export default function CollectionsPage() {
  const [items, setItems] = useState<Collection[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(cursor?: string) {
    setLoading(true);
    try {
      const url = `/merchant/api/merchant/collections?limit=20${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      setItems((prev) => (cursor ? [...prev, ...(data.items ?? [])] : (data.items ?? [])));
      setNextCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto font-mono">

      <div className="flex items-center gap-3 mb-6">
        <div className="w-4 h-px bg-emerald-400/60" />
        <span className="text-[10px] tracking-widest text-white/40 uppercase">Dashboard / Orders</span>
        <div className="flex-1 h-px bg-white/10" />
        {loading && (
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-white/30 animate-pulse" />
            <div className="w-1 h-1 rounded-full bg-white/20 animate-pulse" style={{ animationDelay: '0.2s' }} />
            <div className="w-1 h-1 rounded-full bg-white/10 animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
        )}
      </div>

      {items.length === 0 && !loading ? (
        <div className="border border-white/10 p-12 text-center">
          <p className="text-sm text-white/50 tracking-wide">No orders yet</p>
          <p className="mt-1.5 text-xs text-white/35">Share your payment link to start accepting payments</p>
        </div>
      ) : (
        <>
          <div className="border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.03]">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold tracking-widest text-white/50 uppercase">Payer</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold tracking-widest text-white/50 uppercase">Amount</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold tracking-widest text-white/50 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold tracking-widest text-white/50 uppercase">Settlement</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold tracking-widest text-white/50 uppercase">Time</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const status = STATUS_CONFIG[c.collectionStatus] ?? { label: c.collectionStatus, className: 'text-white/50' };
                  const settle = SETTLE_CONFIG[c.settlementStatus] ?? { label: c.settlementStatus, className: 'text-white/40' };
                  return (
                    <tr key={c.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03] transition-colors">
                      <td className="px-4 py-3.5 text-sm text-white/80">{c.payerName || 'Anonymous'}</td>
                      <td className="px-4 py-3.5 font-bold text-emerald-400">+{c.amountTzs.toLocaleString()} TZS</td>
                      <td className="px-4 py-3.5">
                        <span className={`border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase ${status.className}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`text-xs font-medium tracking-wide ${settle.className}`}>
                          {c.settlementStatus === 'completed' && c.settlementAmountTzs
                            ? `+${c.settlementAmountTzs.toLocaleString()} TZS`
                            : settle.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right text-xs text-white/40">{timeAgo(c.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {nextCursor && (
            <button
              onClick={() => load(nextCursor)}
              disabled={loading}
              className="mt-3 w-full border border-white/10 py-3 text-xs tracking-widest text-white/50 uppercase hover:bg-white/[0.03] disabled:opacity-40 transition-colors"
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
