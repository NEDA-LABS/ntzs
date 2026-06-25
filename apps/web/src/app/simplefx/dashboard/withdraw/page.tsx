'use client';

import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, CheckCircle2, Loader2, AlertCircle, ExternalLink, ShieldCheck } from 'lucide-react';
import { useLp } from '../layout';

type Chain = 'base' | 'bnb';

const TOKENS = [
  { id: 'ntzs',    label: 'nTZS',        chain: 'base' as Chain, explorer: 'https://basescan.org' },
  { id: 'usdc',    label: 'USDC',        chain: 'base' as Chain, explorer: 'https://basescan.org' },
  { id: 'usdt',    label: 'USDT (Base)', chain: 'base' as Chain, explorer: 'https://basescan.org' },
  { id: 'usdt',    label: 'USDT (BNB)',  chain: 'bnb'  as Chain, explorer: 'https://bscscan.com' },
] as const;

type TokenEntry = typeof TOKENS[number];

type WithdrawState = 'idle' | 'loading' | 'success' | 'pending' | 'error';

export default function WithdrawPage() {
  const { lp } = useLp();
  const [selected, setSelected] = useState<TokenEntry>(TOKENS[0]);
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [state, setState] = useState<WithdrawState>('idle');
  const [txHash, setTxHash] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Stable across retries of the same withdrawal so a network retry can't
  // double-spend; regenerated after a confirmed success.
  const idemKeyRef = useRef<string | null>(null);

  const reset = () => {
    setState('idle');
    setToAddress('');
    setAmount('');
    setTxHash('');
    setErrorMsg('');
    idemKeyRef.current = null;
  };

  const handleSubmit = async () => {
    setErrorMsg('');
    setState('loading');
    if (!idemKeyRef.current) idemKeyRef.current = crypto.randomUUID();
    try {
      const res = await fetch('/simplefx/api/lp/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idemKeyRef.current,
        },
        body: JSON.stringify({
          token: selected.id,
          toAddress,
          amount,
          chain: selected.chain,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Withdrawal failed. Please try again.');
        setState('error');
      } else if (data.pending) {
        // Maker-checker: an operator's withdrawal is held for an approver.
        setState('pending');
        idemKeyRef.current = null;
      } else {
        setTxHash(data.txHash);
        setState('success');
        idemKeyRef.current = null;
      }
    } catch {
      setErrorMsg('Network error. Please try again.');
      setState('error');
    }
  };

  const networkLabel = selected.chain === 'bnb' ? 'BNB Smart Chain' : 'Base';

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Withdraw</p>
        <h1 className="text-3xl font-thin text-white mb-2">Move funds out</h1>
        <p className="text-sm text-zinc-500 mb-8">
          Transfer tokens from your inventory wallet to any address on the same network.
        </p>

        <AnimatePresence mode="wait">
          {state === 'pending' ? (
            <motion.div key="pending" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-blue-500/20 bg-blue-950/20 p-8 text-center">
              <ShieldCheck size={32} className="text-blue-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-white mb-1">Submitted for approval</p>
              <p className="text-sm text-zinc-500 mb-6">An approver on your team must authorise this withdrawal before it’s sent.</p>
              <button onClick={reset} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Make another request</button>
            </motion.div>
          ) : state === 'success' ? (
            <motion.div key="success" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-8 text-center">
              <CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-white mb-1">Withdrawal confirmed</p>
              <p className="text-sm text-zinc-500 mb-6">Your transaction has been included on {networkLabel}.</p>
              {txHash && (
                <a href={`${selected.explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors mb-6">
                  View on {selected.chain === 'bnb' ? 'BscScan' : 'Basescan'} <ExternalLink size={11} />
                </a>
              )}
              <br />
              <button onClick={reset} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Make another withdrawal</button>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {lp?.isActive && (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-950/20 p-4">
                  <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-400" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-200">Your liquidity is active in the pool</p>
                    <p className="mt-0.5 text-amber-200/70">
                      While active, your funds sit in the shared solver — your wallet balance is empty, so withdrawals will fail.{' '}
                      <a href="/simplefx/dashboard/rebalance" className="font-medium text-amber-300 underline underline-offset-2 hover:text-amber-200">Deactivate your position</a>{' '}
                      first to move funds back to your wallet, then withdraw.
                    </p>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 mb-6 p-1 bg-zinc-950 border border-white/5 rounded-xl w-fit">
                {TOKENS.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => { setSelected(t); reset(); }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      selected === t
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-white/5 bg-zinc-950 p-6 space-y-4">
                <div className="flex items-center justify-between text-xs text-zinc-600">
                  <span>Network</span>
                  <span className={`px-2 py-0.5 rounded-full border ${selected.chain === 'bnb' ? 'border-yellow-500/20 text-yellow-400 bg-yellow-950/20' : 'border-blue-500/20 text-blue-400 bg-blue-950/20'}`}>
                    {networkLabel}
                  </span>
                </div>

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
                      className="w-full rounded-lg border border-white/8 bg-black/40 px-4 py-3 pr-20 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/40 transition-colors"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-500 pointer-events-none">{selected.id.toUpperCase()}</span>
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
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Withdrawals are irreversible. Send <strong className="text-zinc-300">{selected.label}</strong> only to a{' '}
                    <strong className="text-zinc-300">{networkLabel}</strong> address.
                  </p>
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
                    <><ArrowUpRight size={14} /> Withdraw {selected.label}</>
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
