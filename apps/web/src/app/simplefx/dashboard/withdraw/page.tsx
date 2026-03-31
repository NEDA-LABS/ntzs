'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, CheckCircle2, Loader2, AlertCircle, ExternalLink } from 'lucide-react';

const TOKENS = [
  { id: 'ntzs', label: 'nTZS', decimals: 18 },
  { id: 'usdc', label: 'USDC', decimals: 6 },
] as const;

type WithdrawState = 'idle' | 'loading' | 'success' | 'error';

export default function WithdrawPage() {
  const [token, setToken] = useState<'ntzs' | 'usdc'>('ntzs');
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [state, setState] = useState<WithdrawState>('idle');
  const [txHash, setTxHash] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const reset = () => {
    setState('idle');
    setToAddress('');
    setAmount('');
    setTxHash('');
    setErrorMsg('');
  };

  const handleSubmit = async () => {
    setErrorMsg('');
    setState('loading');
    try {
      const res = await fetch('/simplefx/api/lp/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, toAddress, amount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Withdrawal failed. Please try again.');
        setState('error');
      } else {
        setTxHash(data.txHash);
        setState('success');
      }
    } catch {
      setErrorMsg('Network error. Please try again.');
      setState('error');
    }
  };

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Withdraw</p>
        <h1 className="text-3xl font-thin text-white mb-2">Move funds out</h1>
        <p className="text-sm text-zinc-500 mb-8">Transfer nTZS or USDC from your inventory wallet to any Base address.</p>

        <AnimatePresence mode="wait">
          {state === 'success' ? (
            <motion.div key="success" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-8 text-center">
              <CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-white mb-1">Withdrawal confirmed</p>
              <p className="text-sm text-zinc-500 mb-6">Your transaction has been included on Base.</p>
              {txHash && (
                <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors mb-6">
                  View on Basescan <ExternalLink size={11} />
                </a>
              )}
              <br />
              <button onClick={reset} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Make another withdrawal</button>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="flex gap-2 mb-6 p-1 bg-zinc-950 border border-white/5 rounded-xl w-fit">
                {TOKENS.map((t) => (
                  <button key={t.id} onClick={() => setToken(t.id)} className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${token === t.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30' : 'text-zinc-500 hover:text-zinc-300'}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-white/5 bg-zinc-950 p-6 space-y-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Amount</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full rounded-lg border border-white/8 bg-black/40 px-4 py-3 pr-16 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/40 transition-colors"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-500 pointer-events-none">{token.toUpperCase()}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Destination address</label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={toAddress}
                    onChange={(e) => setToAddress(e.target.value)}
                    className="w-full rounded-lg border border-white/8 bg-black/40 px-4 py-3 text-sm text-white font-mono placeholder-zinc-700 focus:outline-none focus:border-blue-500/40 transition-colors"
                  />
                </div>

                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-950/20 border border-amber-500/15">
                  <AlertCircle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-zinc-400 leading-relaxed">Withdrawals are irreversible. Verify the destination address and network (Base) before confirming.</p>
                </div>

                {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}

                <button
                  disabled={state === 'loading' || !amount || !toAddress}
                  onClick={handleSubmit}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold transition-colors"
                >
                  {state === 'loading' ? (
                    <><Loader2 size={14} className="animate-spin" /> Sending transaction...</>
                  ) : (
                    <><ArrowUpRight size={14} /> Withdraw {token.toUpperCase()}</>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
