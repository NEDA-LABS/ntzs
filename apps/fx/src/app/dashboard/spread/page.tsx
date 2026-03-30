'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Zap } from 'lucide-react';
import { useLp } from '../layout';

function BpsSlider({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: 'blue' | 'indigo';
}) {
  const pct = (value / 100).toFixed(2);
  return (
    <div className="rounded-xl border border-white/5 bg-zinc-950 p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-zinc-300 font-medium">{label}</p>
        <div className="flex items-baseline gap-1">
          <span className={`text-2xl font-light tabular-nums ${color === 'blue' ? 'text-blue-400' : 'text-indigo-400'}`}>
            {pct}
          </span>
          <span className="text-xs text-zinc-600">%</span>
          <span className="text-xs text-zinc-600 ml-1">({value} bps)</span>
        </div>
      </div>
      <input
        type="range"
        min={10}
        max={500}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500 cursor-pointer"
      />
      <div className="flex justify-between text-[10px] text-zinc-700 mt-1">
        <span>0.10%</span>
        <span>5.00%</span>
      </div>
    </div>
  );
}

function SpreadPreview({ bidBps, askBps }: { bidBps: number; askBps: number }) {
  const mid = 3750;
  const bid = (mid * (1 - bidBps / 10000)).toFixed(2);
  const ask = (mid * (1 + askBps / 10000)).toFixed(2);
  const spread = ((askBps + bidBps) / 200).toFixed(2);

  return (
    <div className="rounded-xl border border-white/5 bg-zinc-950 p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-4">Live preview — 1 USDC / nTZS</p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-black/50 p-3">
          <p className="text-[10px] text-zinc-600 mb-1.5 uppercase tracking-wider">Your Bid</p>
          <p className="text-lg font-light text-white tabular-nums">{bid}</p>
          <p className="text-[10px] text-zinc-600 mt-0.5">nTZS per USDC</p>
        </div>
        <div className="rounded-lg bg-blue-600/8 border border-blue-500/15 p-3">
          <p className="text-[10px] text-zinc-500 mb-1.5 uppercase tracking-wider">Mid</p>
          <p className="text-lg font-light text-zinc-400 tabular-nums">{mid}</p>
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

export default function SpreadPage() {
  const { lp, refresh } = useLp();
  const [bidBps, setBidBps] = useState(lp?.bidBps ?? 120);
  const [askBps, setAskBps] = useState(lp?.askBps ?? 150);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activating, setActivating] = useState(false);

  if (!lp) return null;

  const hasChanges = bidBps !== lp.bidBps || askBps !== lp.askBps;

  const saveSpread = async () => {
    setSaving(true);
    await fetch('/api/lp/spread', {
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
    await fetch('/api/lp/activate', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !lp.isActive }),
    });
    await refresh();
    setActivating(false);
  };

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Spread</p>
        <h1 className="text-3xl font-thin text-white mb-2">Configure your spread</h1>
        <p className="text-zinc-500 text-sm mb-8">
          Set how much you earn on each side of every nTZS swap. Higher spread = more earnings per fill, fewer fills.
        </p>

        {/* Sliders */}
        <div className="space-y-4 mb-6">
          <BpsSlider label="Ask spread (you sell nTZS)" value={askBps} onChange={setAskBps} color="blue" />
          <BpsSlider label="Bid spread (you buy nTZS)" value={bidBps} onChange={setBidBps} color="indigo" />
        </div>

        {/* Preview */}
        <div className="mb-6">
          <SpreadPreview bidBps={bidBps} askBps={askBps} />
        </div>

        {/* Save */}
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

        {/* Activate / Deactivate */}
        <div className="rounded-xl border border-white/5 bg-zinc-950 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white font-medium mb-0.5">
                {lp.isActive ? 'Position is live' : 'Position is inactive'}
              </p>
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
