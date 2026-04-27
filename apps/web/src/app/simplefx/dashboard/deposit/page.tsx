'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, CheckCircle2, ArrowUpRight, Info, Smartphone, Loader2 } from 'lucide-react';
import { useLp } from '../layout';

const TOKENS = [
  {
    id: 'ntzs',
    label: 'nTZS',
    icon: '/ntzs-icon.svg',
    description: 'Tokenised Tanzanian Shilling — your primary inventory asset',
    color: 'emerald',
    contract: '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688',
    network: 'Base Mainnet',
    min: '10,000 nTZS',
  },
  {
    id: 'usdc',
    label: 'USDC',
    icon: '/usdc-logo.svg',
    description: 'USD Coin — accepted as collateral on the bid side',
    color: 'blue',
    contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    network: 'Base Mainnet',
    min: 'No minimum',
  },
  {
    id: 'usdt',
    label: 'USDT',
    icon: '/usdt-logo.svg',
    description: 'Tether USD — accepted as collateral on the bid side',
    color: 'blue',
    contract: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
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
        <button onClick={copy} className="flex-none flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors">
          {copied ? <CheckCircle2 size={13} className="text-blue-400" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

type MintState = 'idle' | 'loading' | 'sent' | 'error';

export default function DepositPage() {
  const { lp, refresh } = useLp();
  const [activeToken, setActiveToken] = useState<'ntzs' | 'usdc' | 'usdt'>('ntzs');
  const [balances, setBalances] = useState<{ ntzs: string; usdc: string; usdt?: string } | null>(null);

  const [mintAmount, setMintAmount] = useState('');
  const [mintPhone, setMintPhone] = useState('');
  const [mintState, setMintState] = useState<MintState>('idle');
  const [mintError, setMintError] = useState('');

  const token = TOKENS.find((t) => t.id === activeToken)!;

  useEffect(() => {
    if (!lp) return;
    if (lp.onboardingStep === 1) {
      fetch('/simplefx/api/lp/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 2 }),
      }).then(() => refresh());
    }
    fetch('/simplefx/api/lp/balances').then((r) => r.json()).then(setBalances).catch(() => {});
  }, [lp?.id]);

  if (!lp) return null;

  const fmt = (v: string | undefined) => {
    if (!v) return '—';
    const n = parseFloat(v);
    return n === 0 ? '0' : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Deposit</p>
        <h1 className="text-3xl font-thin text-white mb-6">Fund your inventory</h1>

        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { label: 'nTZS Inventory', value: fmt(balances?.ntzs) },
            { label: 'USDC Balance', value: fmt(balances?.usdc) },
            { label: 'USDT Balance', value: fmt(balances?.usdt) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border border-white/5 bg-zinc-950 px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">{label}</p>
              <p className="text-lg font-light text-white tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mb-8 p-1 bg-zinc-950 border border-white/5 rounded-xl w-fit">
          {TOKENS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveToken(t.id as 'ntzs' | 'usdc' | 'usdt')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeToken === t.id
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <img src={t.icon} alt={t.label} className="h-4 w-4 rounded-full" />
              {t.label}
            </button>
          ))}
        </div>

        <motion.div key={activeToken} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="rounded-2xl border border-white/5 bg-zinc-950 p-6 mb-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-white font-semibold text-lg">{token.label}</p>
              <p className="text-zinc-500 text-sm mt-0.5">{token.description}</p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full border border-white/8 bg-zinc-900 text-zinc-500">{token.network}</span>
          </div>

          <div className="space-y-3 mb-6">
            <CopyField label="Send to this address" value={lp.walletAddress} />
            <CopyField label="Token contract" value={token.contract} />
          </div>

          {activeToken === 'ntzs' && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 h-px bg-white/5" />
                <span className="text-[10px] uppercase tracking-widest text-zinc-600">or deposit via M-Pesa</span>
                <div className="flex-1 h-px bg-white/5" />
              </div>

              <AnimatePresence mode="wait">
                {mintState === 'sent' ? (
                  <motion.div key="sent" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4 text-center">
                    <Smartphone size={20} className="text-emerald-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-emerald-300 mb-1">Check your phone</p>
                    <p className="text-xs text-zinc-500">An M-Pesa prompt has been sent. Once you confirm, nTZS will be minted to your inventory wallet automatically.</p>
                    <button onClick={() => { setMintState('idle'); setMintAmount(''); setMintPhone(''); }} className="mt-3 text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
                      Make another deposit
                    </button>
                  </motion.div>
                ) : (
                  <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <div className="space-y-2 mb-3">
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs text-zinc-600 pointer-events-none">TZS</span>
                        <input
                          type="number"
                          min="500"
                          placeholder="Amount in TZS (min 500)"
                          value={mintAmount}
                          onChange={(e) => setMintAmount(e.target.value)}
                          className="w-full rounded-lg border border-white/8 bg-zinc-900 pl-12 pr-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-colors"
                        />
                      </div>
                      <div className="relative">
                        <Smartphone size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                        <input
                          type="tel"
                          placeholder="Phone number (e.g. 0741 234 567)"
                          value={mintPhone}
                          onChange={(e) => setMintPhone(e.target.value)}
                          className="w-full rounded-lg border border-white/8 bg-zinc-900 pl-10 pr-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-colors"
                        />
                      </div>
                    </div>

                    {mintError && <p className="text-xs text-red-400 mb-3">{mintError}</p>}

                    <button
                      disabled={mintState === 'loading' || !mintAmount || !mintPhone}
                      onClick={async () => {
                        setMintError('');
                        setMintState('loading');
                        try {
                          const res = await fetch('/simplefx/api/lp/mint', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ amountTzs: Number(mintAmount), phoneNumber: mintPhone }),
                          });
                          const data = await res.json();
                          if (!res.ok) {
                            setMintError(data.error || 'Deposit failed. Please try again.');
                            setMintState('error');
                          } else {
                            setMintState('sent');
                          }
                        } catch {
                          setMintError('Network error. Please try again.');
                          setMintState('error');
                        }
                      }}
                      className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 text-sm font-medium text-white transition-colors"
                    >
                      {mintState === 'loading' ? (
                        <><Loader2 size={14} className="animate-spin" /> Sending prompt...</>
                      ) : (
                        <><Smartphone size={14} /> Deposit via M-Pesa</>
                      )}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

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

        <a href={`https://basescan.org/address/${lp.walletAddress}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
          View on Basescan <ArrowUpRight size={12} />
        </a>
      </motion.div>
    </div>
  );
}
