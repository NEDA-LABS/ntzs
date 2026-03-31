'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Zap } from 'lucide-react';
import { useLp } from '../layout';

// ─── Slider + number input (synced) ──────────────────────────────────────────

function BpsControl({
  label,
  value,
  onChange,
  color,
  mid,
  side,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: 'blue' | 'indigo';
  mid: number;
  side: 'ask' | 'bid';
}) {
  const pct = (value / 100).toFixed(2);
  const absolutePrice = side === 'ask'
    ? (mid * (1 + value / 10000)).toFixed(2)
    : (mid * (1 - value / 10000)).toFixed(2);

  const [priceInput, setPriceInput] = useState(absolutePrice);

  // Keep priceInput in sync when bps or mid changes
  useEffect(() => {
    setPriceInput(absolutePrice);
  }, [absolutePrice]);

  const handlePriceBlur = () => {
    const price = parseFloat(priceInput);
    if (isNaN(price) || price <= 0 || mid <= 0) {
      setPriceInput(absolutePrice);
      return;
    }
    // Back-calculate bps from the entered price, clamp only to valid bps range (10–500)
    let bps: number;
    if (side === 'ask') {
      bps = Math.round((price / mid - 1) * 10000);
    } else {
      bps = Math.round((1 - price / mid) * 10000);
    }
    const clamped = Math.max(10, Math.min(500, bps));
    onChange(clamped);
  };

  const accentColor = color === 'blue' ? 'text-blue-400' : 'text-indigo-400';

  return (
    <div className="rounded-xl border border-white/5 bg-zinc-950 p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-zinc-300 font-medium">{label}</p>
        <div className="flex items-baseline gap-1">
          <span className={`text-2xl font-light tabular-nums ${accentColor}`}>{pct}</span>
          <span className="text-xs text-zinc-600">%</span>
          <span className="text-xs text-zinc-600 ml-1">({value} bps)</span>
        </div>
      </div>

      {/* Slider */}
      <input
        type="range"
        min={10}
        max={500}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500 cursor-pointer"
      />
      <div className="flex justify-between text-[10px] text-zinc-700 mt-1 mb-4">
        <span>0.10%</span>
        <span>5.00%</span>
      </div>

      {/* Manual price input */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">
            {side === 'ask' ? 'Your ask price' : 'Your bid price'} (nTZS per USDC)
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            onBlur={handlePriceBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') handlePriceBlur(); }}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white tabular-nums focus:border-blue-500/50 focus:outline-none"
          />
        </div>
        <p className="text-[10px] text-zinc-600 mt-5 shrink-0">
          ← or use slider
        </p>
      </div>
    </div>
  );
}

// ─── Spread preview ───────────────────────────────────────────────────────────

function SpreadPreview({ bidBps, askBps, mid }: { bidBps: number; askBps: number; mid: number }) {
  const bid    = (mid * (1 - bidBps / 10000)).toFixed(2);
  const ask    = (mid * (1 + askBps / 10000)).toFixed(2);
  const spread = ((askBps + bidBps) / 200).toFixed(2);

  return (
    <div className="rounded-xl border border-white/5 bg-zinc-950 p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-4">
        Live preview — 1 USDC / nTZS · Mid: {mid.toLocaleString()}
      </p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-black/50 p-3">
          <p className="text-[10px] text-zinc-600 mb-1.5 uppercase tracking-wider">Your Bid</p>
          <p className="text-lg font-light text-white tabular-nums">{bid}</p>
          <p className="text-[10px] text-zinc-600 mt-0.5">nTZS per USDC</p>
        </div>
        <div className="rounded-lg bg-blue-600/8 border border-blue-500/15 p-3">
          <p className="text-[10px] text-zinc-500 mb-1.5 uppercase tracking-wider">Mid</p>
          <p className="text-lg font-light text-zinc-400 tabular-nums">{mid.toLocaleString()}</p>
          <p className="text-[10px] text-blue-400 mt-0.5">+{spread}% spread</p>
        </div>
        <div className="rounded-lg bg-black/50 p-3">
          <p className="text-[10px] text-zinc-600 mb-1.5 uppercase tracking-wider">Your Ask</p>
          <p className="text-lg font-light text-white tabular-nums">{ask}</p>
          <p className="text-[10px] text-zinc-600 mt-0.5">nTZS per USDC</p>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SpreadPage() {
  const { lp, refresh } = useLp();
  const [bidBps, setBidBps] = useState(120);
  const [askBps, setAskBps] = useState(150);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activating, setActivating] = useState(false);
  const [mid, setMid] = useState(3750);

  // Fetch live mid rate
  useEffect(() => {
    fetch('/simplefx/api/lp/rate')
      .then((r) => r.json())
      .then((d) => { if (d.midRateTZS) setMid(d.midRateTZS); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (lp) {
      setBidBps(lp.bidBps);
      setAskBps(lp.askBps);
    }
  }, [lp?.bidBps, lp?.askBps]);

  if (!lp) return null;

  const hasChanges = bidBps !== lp.bidBps || askBps !== lp.askBps;

  const saveSpread = async () => {
    setSaving(true);
    await fetch('/simplefx/api/lp/spread', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bidBps, askBps }),
    });
    await refresh();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const toggleActive = async () => {
    setActivating(true);
    await fetch('/simplefx/api/lp/activate', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !lp.isActive }),
    });
    await refresh();
    setActivating(false);
  };

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Spread</p>
        <h1 className="text-3xl font-thin text-white mb-2">Configure your spread</h1>
        <p className="text-zinc-500 text-sm mb-8">
          Set how much you earn on each side of every nTZS swap. Adjust with the slider or type an absolute price directly.
        </p>

        <div className="space-y-4 mb-6">
          <BpsControl label="Ask spread (you sell nTZS)" value={askBps} onChange={setAskBps} color="blue"   mid={mid} side="ask" />
          <BpsControl label="Bid spread (you buy nTZS)"  value={bidBps} onChange={setBidBps} color="indigo" mid={mid} side="bid" />
        </div>

        <div className="mb-6">
          <SpreadPreview bidBps={bidBps} askBps={askBps} mid={mid} />
        </div>

        <div className="flex items-center gap-3 mb-10">
          <button
            onClick={saveSpread}
            disabled={saving || !hasChanges}
            className="px-6 py-2.5 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white text-sm font-medium hover:from-blue-400 hover:to-blue-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save spread'}
          </button>
          {saved && <CheckCircle2 size={16} className="text-blue-400" />}
        </div>

        <div className="rounded-xl border border-white/5 bg-zinc-950 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white font-medium mb-0.5">{lp.isActive ? 'Position is live' : 'Position is inactive'}</p>
              <p className="text-xs text-zinc-500">
                {lp.isActive
                  ? 'Orders are filling against your inventory in real time.'
                  : 'Activate to start receiving order fills automatically.'}
              </p>
            </div>
            <button
              onClick={toggleActive}
              disabled={activating}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                lp.isActive
                  ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  : 'bg-gradient-to-br from-blue-500 to-blue-700 text-white hover:from-blue-400 hover:to-blue-600'
              }`}
            >
              <Zap size={14} />
              {activating ? '...' : lp.isActive ? 'Deactivate' : 'Go Live'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
