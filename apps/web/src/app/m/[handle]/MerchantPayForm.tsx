'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const quickAmounts = [1000, 5000, 10000, 50000];

type PayerStatus = 'pending' | 'processing' | 'success' | 'failed';

interface Props {
  handle: string;
  displayName: string;
  fixedAmount: number | null;
  description: string | null;
  initialAmount?: string;
  linkId: string | null;
}

export function MerchantPayForm({ handle, displayName, fixedAmount, description, initialAmount, linkId }: Props) {
  const [amount, setAmount] = useState(fixedAmount ? String(fixedAmount) : (initialAmount ?? ''));
  const [phone, setPhone] = useState('');
  const [payerName, setPayerName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [depositId, setDepositId] = useState<string | null>(null);
  const [payStatus, setPayStatus] = useState<PayerStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!depositId) return;
    setPayStatus('pending');

    async function checkStatus() {
      try {
        const res = await fetch(`/api/pay/status?id=${depositId}`);
        if (!res.ok) return;
        const data = await res.json();
        setPayStatus(data.status);
        if (data.status === 'success' || data.status === 'failed') stopPolling();
      } catch {
        // retry silently
      }
    }

    checkStatus();
    pollRef.current = setInterval(checkStatus, 3000);
    const timeout = setTimeout(() => stopPolling(), 5 * 60 * 1000);

    return () => {
      stopPolling();
      clearTimeout(timeout);
    };
  }, [depositId, stopPolling]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const amountNum = Number(amount);
    if (!amountNum || amountNum < 100) {
      setError('Enter a valid amount (minimum 100 TZS)');
      return;
    }
    if (!phone) {
      setError('Enter your phone number');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/merchant/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, amountTzs: amountNum, phone, payerName, linkId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong');
      } else {
        setDepositId(data.depositId);
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  // Status screen
  if (depositId && payStatus) {
    return (
      <div className="py-8 text-center font-mono" style={{ colorScheme: 'light' }}>
        {payStatus === 'success' ? (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center border border-emerald-200 bg-emerald-50 mb-5">
              <svg className="h-6 w-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-[10px] tracking-widest text-emerald-500 uppercase mb-2">Payment Confirmed</p>
            <p className="text-sm text-zinc-600">
              <span className="font-bold text-zinc-900">{Number(amount).toLocaleString()} TZS</span>{' '}
              sent to {displayName}
            </p>
          </>
        ) : payStatus === 'failed' ? (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center border border-rose-200 bg-rose-50 mb-5">
              <svg className="h-6 w-6 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-[10px] tracking-widest text-rose-500 uppercase mb-2">Payment Failed</p>
            <p className="text-xs text-zinc-400 mb-5">The payment was not completed. Please try again.</p>
            <button
              type="button"
              onClick={() => { setDepositId(null); setPayStatus(null); }}
              className="border border-zinc-200 px-5 py-2.5 text-[10px] tracking-widest text-zinc-500 uppercase hover:bg-zinc-50 transition-colors"
            >
              Try Again
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center border border-emerald-100 bg-emerald-50 mb-5">
              <svg className="h-6 w-6 animate-spin text-emerald-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <p className="text-[10px] tracking-widest text-zinc-400 uppercase mb-2">
              {payStatus === 'pending' ? 'Awaiting Approval' : 'Processing Payment'}
            </p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              {payStatus === 'pending'
                ? 'Check your phone and approve the payment prompt'
                : 'Payment received — finalising transaction'}
            </p>
            <p className="mt-4 text-[10px] text-zinc-300">
              <span className="text-zinc-500">{Number(amount).toLocaleString()} TZS</span>
              {' '}to {displayName}
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 font-mono" style={{ colorScheme: 'light' }}>
      {description && (
        <div className="border border-zinc-100 bg-zinc-50 px-4 py-3">
          <p className="text-[10px] tracking-widest text-zinc-400 uppercase mb-0.5">Payment For</p>
          <p className="text-sm text-zinc-600">{description}</p>
        </div>
      )}

      {/* Amount */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] tracking-widest text-zinc-400 uppercase">Amount (TZS)</label>
          {fixedAmount && <span className="text-[10px] tracking-widest text-zinc-300 uppercase">Fixed</span>}
        </div>
        <input
          type="number"
          inputMode="numeric"
          placeholder="0"
          value={amount}
          readOnly={!!fixedAmount}
          onChange={(e) => !fixedAmount && setAmount(e.target.value)}
          className={`w-full border px-4 py-4 text-3xl font-bold text-zinc-900 placeholder:text-zinc-200 focus:outline-none bg-white transition-colors ${
            fixedAmount
              ? 'border-zinc-100 cursor-default text-zinc-700'
              : 'border-zinc-200 focus:border-emerald-500'
          }`}
        />
        {!fixedAmount && (
          <div className="mt-2 flex gap-1.5">
            {quickAmounts.map((qa) => (
              <button
                key={qa}
                type="button"
                onClick={() => setAmount(String(qa))}
                className="flex-1 border border-zinc-100 py-1.5 text-[10px] tracking-wide text-zinc-400 uppercase hover:border-zinc-300 hover:text-zinc-700 transition-colors"
              >
                {qa >= 1000 ? `${qa / 1000}k` : qa}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Phone */}
      <div>
        <label className="mb-2 block text-[10px] tracking-widest text-zinc-400 uppercase">Your Phone Number</label>
        <input
          type="tel"
          inputMode="tel"
          placeholder="07XX XXX XXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-300 focus:border-emerald-500 focus:outline-none transition-colors"
        />
      </div>

      {/* Name */}
      <div>
        <label className="mb-2 block text-[10px] tracking-widest text-zinc-400 uppercase">
          Your Name <span className="text-zinc-300 normal-case tracking-normal font-normal">(optional)</span>
        </label>
        <input
          type="text"
          placeholder="Jane"
          value={payerName}
          onChange={(e) => setPayerName(e.target.value)}
          className="w-full border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-300 focus:border-emerald-500 focus:outline-none transition-colors"
        />
      </div>

      {error && (
        <p className="border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-600">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-zinc-900 px-6 py-4 text-xs font-medium tracking-widest text-white uppercase transition-colors hover:bg-zinc-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? 'Sending...' : `Pay ${displayName}`}
      </button>
    </form>
  );
}
