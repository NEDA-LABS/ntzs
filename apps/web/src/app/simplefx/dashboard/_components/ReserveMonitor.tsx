'use client';

import { useState, useEffect } from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';

type Reserve = {
  ntzsIssued: number;
  reserveTzs: number;
  pendingTzs: number;
  ratio: number;
  asOf: string;
};

const fmtTzs = (n: number) => 'TZS ' + Math.round(n).toLocaleString('en-US');
const fmtNtzs = (n: number) => Math.round(n).toLocaleString('en-US');

export default function ReserveMonitor() {
  const [reserve, setReserve] = useState<Reserve | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  const load = () => {
    setLoading(true);
    setErr(false);
    fetch('/simplefx/api/lp/reserve')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Reserve) => setReserve(d))
      .catch(() => setErr(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const hasIssuance = !!reserve && reserve.ntzsIssued > 0;
  const fullyBacked = !reserve || reserve.reserveTzs >= reserve.ntzsIssued;

  return (
    <div className="rounded-xl border border-white/5 bg-zinc-950 p-5">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-blue-400" />
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-600">Reserve monitor</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-300 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {err ? (
        <p className="text-xs text-red-400">Couldn’t load reserve figures. Tap refresh to retry.</p>
      ) : (
        <>
          {/* Hero — on-chain supply is the figure that anchors the 1:1 obligation */}
          <div className="mb-5">
            <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-600 mb-2">nTZS in circulation</p>
            {loading && !reserve ? (
              <div className="h-9 w-52 rounded bg-white/5 animate-pulse" />
            ) : (
              <p className="text-4xl font-thin tracking-tight text-white">
                {reserve ? fmtNtzs(reserve.ntzsIssued) : '—'}
                <span className="ml-2 text-lg text-zinc-600">nTZS</span>
              </p>
            )}
            <p className="mt-1.5 text-xs text-zinc-600">
              Live on-chain supply on Base — the issuance your TZS reserves back 1:1.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/5 bg-white/2 p-4">
              <p className="text-[11px] text-zinc-600 mb-2 uppercase tracking-[0.2em]">TZS reserves</p>
              {loading && !reserve ? (
                <div className="h-6 w-24 rounded bg-white/5 animate-pulse" />
              ) : (
                <p className="text-lg font-light tracking-tight text-white">
                  {reserve ? fmtTzs(reserve.reserveTzs) : '—'}
                </p>
              )}
              <p className="text-xs text-zinc-600 mt-1">Deposit-backed, held in trust</p>
            </div>
            <div className="rounded-lg border border-white/5 bg-white/2 p-4">
              <p className="text-[11px] text-zinc-600 mb-2 uppercase tracking-[0.2em]">Backing ratio</p>
              {loading && !reserve ? (
                <div className="h-6 w-16 rounded bg-white/5 animate-pulse" />
              ) : (
                <p className={`text-lg font-light tracking-tight ${fullyBacked ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {reserve ? (hasIssuance ? `${reserve.ratio.toFixed(2)} : 1` : '1 : 1') : '—'}
                </p>
              )}
              <p className="text-xs text-zinc-600 mt-1">{fullyBacked ? 'Fully backed' : 'Below 1:1 — review'}</p>
            </div>
          </div>

          {reserve && reserve.pendingTzs > 0 && (
            <p className="mt-4 text-xs text-zinc-600">
              + {fmtTzs(reserve.pendingTzs)} in deposits in-flight (not yet issued).
            </p>
          )}
          {reserve && (
            <p className="mt-2 text-[11px] text-zinc-700">As of {new Date(reserve.asOf).toLocaleString()}</p>
          )}
        </>
      )}
    </div>
  );
}
