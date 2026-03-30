'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Copy, CheckCircle2, ArrowUpRight, Info } from 'lucide-react';
import { useLp } from '../layout';

const TOKENS = [
  {
    id: 'ntzs',
    label: 'nTZS',
    description: 'Tokenised Tanzanian Shilling — your primary inventory asset',
    color: 'emerald',
    contract: '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688',
    network: 'Base Mainnet',
    min: '10,000 nTZS',
  },
  {
    id: 'usdc',
    label: 'USDC',
    description: 'USD Coin — accepted as collateral on the bid side',
    color: 'blue',
    contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    network: 'Base Mainnet',
    min: 'No minimum',
  },
];

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-lg border border-white/5 bg-black/40 px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">{label}</p>
      <div className="flex items-center gap-3">
        <p className="text-sm text-zinc-300 font-mono flex-1 truncate">{value}</p>
        <button
          onClick={copy}
          className="flex-none flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors"
        >
          {copied
            ? <CheckCircle2 size={13} className="text-blue-400" />
            : <Copy size={13} />
          }
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default function DepositPage() {
  const { lp, refresh } = useLp();
  const [activeToken, setActiveToken] = useState<'ntzs' | 'usdc'>('ntzs');
  const token = TOKENS.find((t) => t.id === activeToken)!;

  useEffect(() => {
    if (lp && lp.onboardingStep === 1) {
      fetch('/api/lp/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 2 }),
      }).then(() => refresh());
    }
  }, [lp?.id]);

  if (!lp) return null;

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Deposit</p>
        <h1 className="text-3xl font-thin text-white mb-8">Fund your inventory</h1>

        {/* Token tabs */}
        <div className="flex gap-2 mb-8 p-1 bg-zinc-950 border border-white/5 rounded-xl w-fit">
          {TOKENS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveToken(t.id as 'ntzs' | 'usdc')}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeToken === t.id
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Token deposit card */}
        <motion.div
          key={activeToken}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl border border-white/5 bg-zinc-950 p-6 mb-6"
        >
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-white font-semibold text-lg">{token.label}</p>
              <p className="text-zinc-500 text-sm mt-0.5">{token.description}</p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full border border-white/8 bg-zinc-900 text-zinc-500">
              {token.network}
            </span>
          </div>

          <div className="space-y-3 mb-6">
            <CopyField label="Send to this address" value={lp.walletAddress} />
            <CopyField label="Token contract" value={token.contract} />
          </div>

          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-950/30 border border-blue-500/15">
            <Info size={14} className="text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-zinc-400 leading-relaxed">
              Send <strong className="text-zinc-300">{token.label}</strong> only on{' '}
              <strong className="text-zinc-300">{token.network}</strong> to the address above.
              Minimum deposit: <strong className="text-zinc-300">{token.min}</strong>.
              Funds appear in your inventory within 2–3 block confirmations.
            </p>
          </div>
        </motion.div>

        {/* Basescan link */}
        <a
          href={`https://basescan.org/address/${lp.walletAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-xs text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          View on Basescan <ArrowUpRight size={12} />
        </a>
      </motion.div>
    </div>
  );
}
