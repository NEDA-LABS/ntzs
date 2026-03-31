'use client';

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDownUp, CheckCircle2, Loader2, XCircle, AlertCircle, ChevronRight } from 'lucide-react';

type TokenSymbol = 'USDC' | 'NTZS';

interface StatusUpdate {
  status: string;
  message: string;
  txHash?: string;
  orderId?: string;
  error?: string;
}

const STATUS_COLORS: Record<string, string> = {
  CONNECTING: 'text-zinc-400',
  PREPARING: 'text-zinc-400',
  PLACING_ORDER: 'text-blue-400',
  ORDER_PLACED: 'text-blue-400',
  AWAITING_BIDS: 'text-yellow-400',
  BIDS_RECEIVED: 'text-yellow-400',
  BID_SELECTED: 'text-orange-400',
  USEROP_SUBMITTED: 'text-orange-400',
  PARTIAL_FILL: 'text-orange-400',
  FILLED: 'text-green-400',
  FAILED: 'text-red-400',
  PARTIAL_FILL_EXHAUSTED: 'text-red-400',
};

function StatusIcon({ status }: { status: string }) {
  if (status === 'FILLED') return <CheckCircle2 size={16} className="text-green-400" />;
  if (status === 'FAILED' || status === 'PARTIAL_FILL_EXHAUSTED') return <XCircle size={16} className="text-red-400" />;
  return <Loader2 size={16} className="animate-spin text-blue-400" />;
}

export default function SwapTestPage() {
  const [fromToken, setFromToken] = useState<TokenSymbol>('USDC');
  const [toToken, setToToken] = useState<TokenSymbol>('NTZS');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(100);

  const [rate, setRate] = useState<{ expectedOutput: number; minOutput: number; midRate: number } | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  const [logs, setLogs] = useState<StatusUpdate[]>([]);
  const [swapping, setSwapping] = useState(false);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const terminalStates = ['FILLED', 'FAILED', 'PARTIAL_FILL_EXHAUSTED'];

  const flip = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setRate(null);
    setAmount('');
  };

  const fetchRate = async (amt: string) => {
    if (!amt || parseFloat(amt) <= 0) { setRate(null); return; }
    setRateLoading(true);
    try {
      const res = await fetch(`/api/v1/swap/rate?from=${fromToken}&to=${toToken}&amount=${amt}`);
      if (res.ok) setRate(await res.json());
    } catch { /* ignore */ } finally {
      setRateLoading(false);
    }
  };

  const handleAmountChange = (v: string) => {
    setAmount(v);
    fetchRate(v);
  };

  const startSwap = async () => {
    if (!amount || !rate) return;
    setLogs([]);
    setDone(false);
    setSwapping(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/simplefx/api/lp/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromToken, toToken, amount: parseFloat(amount), slippageBps }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        setLogs([{ status: 'FAILED', message: text }]);
        setSwapping(false);
        setDone(true);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let buffer = '';
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const update: StatusUpdate = JSON.parse(line.slice(6));
              setLogs((prev) => [...prev, update]);
              if (terminalStates.includes(update.status)) {
                setDone(true);
                setSwapping(false);
              }
            } catch { /* ignore malformed */ }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setLogs((prev) => [...prev, { status: 'FAILED', message: err.message }]);
      }
    } finally {
      setSwapping(false);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setSwapping(false);
    setDone(true);
  };

  const lastStatus = logs[logs.length - 1]?.status;
  const isFilled = lastStatus === 'FILLED';
  const isFailed = lastStatus === 'FAILED' || lastStatus === 'PARTIAL_FILL_EXHAUSTED';

  return (
    <div className="px-6 py-8 max-w-lg mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Swap</p>
        <h1 className="text-3xl font-thin text-white mb-8">Test Swap</h1>

        <div className="rounded-xl border border-white/8 bg-white/2 p-6 space-y-4">

          {/* From token */}
          <div>
            <p className="text-xs text-zinc-600 uppercase tracking-[0.15em] mb-2">You pay</p>
            <div className="flex items-center gap-3">
              <div className="flex-none px-3 py-2 rounded-lg bg-zinc-900 border border-white/8 text-sm font-medium text-white">
                {fromToken}
              </div>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                disabled={swapping}
                className="flex-1 bg-transparent text-right text-2xl font-light text-white placeholder-zinc-700 outline-none disabled:opacity-50"
              />
            </div>
          </div>

          {/* Flip button */}
          <div className="flex justify-center">
            <button
              onClick={flip}
              disabled={swapping}
              className="p-2 rounded-full border border-white/8 hover:border-blue-500/30 hover:bg-blue-600/5 transition-all disabled:opacity-40"
            >
              <ArrowDownUp size={16} className="text-zinc-500" />
            </button>
          </div>

          {/* To token */}
          <div>
            <p className="text-xs text-zinc-600 uppercase tracking-[0.15em] mb-2">You receive</p>
            <div className="flex items-center gap-3">
              <div className="flex-none px-3 py-2 rounded-lg bg-zinc-900 border border-white/8 text-sm font-medium text-white">
                {toToken}
              </div>
              <div className="flex-1 text-right">
                {rateLoading ? (
                  <Loader2 size={16} className="animate-spin text-zinc-600 ml-auto" />
                ) : rate ? (
                  <div>
                    <p className="text-2xl font-light text-white">
                      ≈ {rate.expectedOutput.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                    </p>
                    <p className="text-xs text-zinc-600 mt-0.5">
                      min {rate.minOutput.toLocaleString('en-US', { maximumFractionDigits: 4 })} · mid {rate.midRate.toLocaleString()}
                    </p>
                  </div>
                ) : (
                  <p className="text-2xl font-light text-zinc-700">—</p>
                )}
              </div>
            </div>
          </div>

          {/* Slippage */}
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <p className="text-xs text-zinc-600">Slippage tolerance</p>
            <div className="flex gap-1.5">
              {[50, 100, 200].map((bps) => (
                <button
                  key={bps}
                  onClick={() => setSlippageBps(bps)}
                  className={`text-xs px-2 py-0.5 rounded-md transition-colors ${
                    slippageBps === bps
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                      : 'bg-zinc-900 text-zinc-500 border border-white/5 hover:text-zinc-300'
                  }`}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
          </div>

          {/* Warning for LP using their own wallet */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/15">
            <AlertCircle size={14} className="text-yellow-500 flex-none mt-0.5" />
            <p className="text-xs text-yellow-500/80 leading-relaxed">
              This swaps from your LP wallet. Ensure it has tokens before activating. Funds in the solver pool are separate.
            </p>
          </div>

          {/* Swap button */}
          <button
            onClick={swapping ? cancel : startSwap}
            disabled={!amount || !rate || rateLoading}
            className={`w-full py-3 rounded-xl text-sm font-medium transition-all ${
              swapping
                ? 'bg-red-600/10 text-red-400 border border-red-500/20 hover:bg-red-600/20'
                : isFilled
                ? 'bg-green-600/10 text-green-400 border border-green-500/20'
                : 'bg-blue-600/15 text-blue-400 border border-blue-500/25 hover:bg-blue-600/25 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {swapping ? 'Cancel swap' : isFilled ? 'Swap complete' : 'Swap via HyperBridge'}
          </button>
        </div>

        {/* Status log */}
        <AnimatePresence>
          {logs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-xl border border-white/5 bg-white/2 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-white/5">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-600">Order status</p>
              </div>
              <div className="divide-y divide-white/5">
                {logs.map((log, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                    <StatusIcon status={log.status} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${STATUS_COLORS[log.status] ?? 'text-zinc-400'}`}>
                        {log.message}
                      </p>
                      {log.txHash && (
                        <a
                          href={`https://basescan.org/tx/${log.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-zinc-600 hover:text-zinc-400 font-mono truncate block mt-0.5"
                        >
                          {log.txHash.slice(0, 20)}…{log.txHash.slice(-8)}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
