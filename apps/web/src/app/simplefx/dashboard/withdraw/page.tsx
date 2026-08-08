'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, CheckCircle2, Loader2, AlertCircle, ExternalLink, ShieldCheck, Bookmark } from 'lucide-react';
import { useLp } from '../layout';
import { SelectMenu } from '../_components/SelectMenu';

type Chain = 'base' | 'bnb';

const TOKENS = [
  { id: 'ntzs',    label: 'nTZS',        chain: 'base' as Chain, explorer: 'https://basescan.org' },
  { id: 'usdc',    label: 'USDC',        chain: 'base' as Chain, explorer: 'https://basescan.org' },
  { id: 'usdt',    label: 'USDT (Base)', chain: 'base' as Chain, explorer: 'https://basescan.org' },
  { id: 'usdt',    label: 'USDT (BNB)',  chain: 'bnb'  as Chain, explorer: 'https://bscscan.com' },
] as const;

type TokenEntry = typeof TOKENS[number];

/**
 * A bank's nTZS is reserve, not inventory: it leaves by redemption to shillings
 * so supply falls with it, never as an on-chain transfer. Its earned stables are
 * its own asset and go wherever it banks them — custody, an OTC desk, or any
 * other institution that takes stablecoin.
 */
const STABLES_ONLY: readonly TokenEntry[] = TOKENS.filter((t) => t.id !== 'ntzs');

type WithdrawState = 'idle' | 'loading' | 'success' | 'pending' | 'error' | 'unresolved';

interface Destination {
  id: string;
  kind: 'crypto' | 'bank';
  label: string;
  chain: string | null;
  address: string | null;
  bankCode: string | null;
  accountNumber: string | null;
}

/** Sentinel for "type it out this time" — an id can never collide with it. */
const NEW_DESTINATION = '__new__';

export default function WithdrawPage() {
  const { lp } = useLp();
  const [tokenChoice, setTokenChoice] = useState<TokenEntry | null>(null);
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [state, setState] = useState<WithdrawState>('idle');
  const [txHash, setTxHash] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Banks redeem their reserve to cash: burn nTZS, receive TZS in their bank
  // account. Crypto LPs move tokens on-chain. Both ride the same maker-checker.
  const isBank = lp?.accountType === 'bank';
  // `lp` arrives a tick after mount, so neither of these can be seeded from it
  // at useState time — null means "follow the account", which resolves as soon
  // as the account is known and still lets an explicit choice win.
  const [modeChoice, setModeChoice] = useState<'crypto' | 'bank' | null>(null);
  const mode: 'crypto' | 'bank' = modeChoice ?? (isBank ? 'bank' : 'crypto');

  const tokens = isBank ? STABLES_ONLY : TOKENS;
  const selected: TokenEntry =
    tokenChoice && tokens.includes(tokenChoice) ? tokenChoice : tokens[0];
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [cashoutNote, setCashoutNote] = useState('');
  const [banks, setBanks] = useState<Array<{ code: string; name: string }>>([]);

  // Saved destinations. An irreversible address retyped every cycle is the
  // riskiest step here, so the common case is picking one that was checked once.
  const [destinations, setDestinations] = useState<Destination[]>([]);
  // null = follow the account's own list, so a bank that settles to the same
  // place every cycle finds it already selected.
  const [destinationChoice, setDestinationChoice] = useState<string | null>(null);
  const [saveLabel, setSaveLabel] = useState('');
  const [saveError, setSaveError] = useState('');

  const loadDestinations = useCallback(async () => {
    try {
      const d = await (await fetch('/simplefx/api/lp/destinations')).json();
      setDestinations((d.destinations ?? []) as Destination[]);
    } catch { /* the manual path still works without them */ }
  }, []);

  useEffect(() => { loadDestinations(); }, [loadDestinations]);

  useEffect(() => {
    if (!isBank) return;
    fetch('/simplefx/api/lp/banks')
      .then((r) => r.json())
      .then((d) => {
        setBanks(d.banks ?? []);
        if (!bankCode && d.banks?.[0]) setBankCode(d.banks[0].code);
      })
      .catch(() => {});
  }, [isBank]);

  // Only destinations for the rail (and chain) currently in view — offering a
  // Base address while BNB is selected is an invitation to send into a void.
  const relevantDestinations = destinations.filter((d) =>
    mode === 'bank' ? d.kind === 'bank' : d.kind === 'crypto' && d.chain === selected.chain,
  );
  const destinationId = destinationChoice ?? relevantDestinations[0]?.id ?? NEW_DESTINATION;
  const chosen = relevantDestinations.find((d) => d.id === destinationId) ?? null;

  // Derived, never copied into state: a saved destination that is mirrored into
  // the input can drift from the row it came from, and the value that drifts is
  // the one the money goes to.
  const effectiveToAddress = chosen?.kind === 'crypto' ? chosen.address ?? '' : toAddress;
  const effectiveBankCode = chosen?.kind === 'bank' ? chosen.bankCode ?? '' : bankCode;
  const effectiveAccount = chosen?.kind === 'bank' ? chosen.accountNumber ?? '' : accountNumber;

  const pickDestination = (id: string) => {
    setDestinationChoice(id);
    setErrorMsg('');
  };

  const saveDestination = async () => {
    setSaveError('');
    const body = mode === 'bank'
      ? { kind: 'bank', label: saveLabel.trim(), bankCode, accountNumber }
      : { kind: 'crypto', label: saveLabel.trim(), chain: selected.chain, address: toAddress };

    try {
      const res = await fetch('/simplefx/api/lp/destinations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setSaveError(d?.error || 'Could not save that destination.'); return; }
      setSaveLabel('');
      await loadDestinations();
      if (d?.destination?.id) setDestinationChoice(d.destination.id);
    } catch { setSaveError('Network error. Please try again.'); }
  };

  // Stable across retries of the same withdrawal so a network retry can't
  // double-spend; regenerated after a confirmed success.
  const idemKeyRef = useRef<string | null>(null);

  const reset = () => {
    setState('idle');
    setAmount('');
    setToAddress('');
    setAccountNumber('');
    setTxHash('');
    setErrorMsg('');
    setCashoutNote('');
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
        body: JSON.stringify(
          mode === 'bank'
            ? { method: 'bank', amountTzs: Number(amount), bankCode: effectiveBankCode, accountNumber: effectiveAccount }
            : { token: selected.id, toAddress: effectiveToAddress, amount, chain: selected.chain },
        ),
      });
      // A crashed route can answer with an empty body; parsing it blind threw
      // and dropped every real cause into the generic "Network error" branch.
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMsg(data?.error || `Withdrawal failed (HTTP ${res.status}).`);
        // The send may have gone out. Offering "try again" here is how one
        // payment becomes two, so this state says so and offers no retry.
        setState(data?.indeterminate ? 'unresolved' : 'error');
      } else if (data.pending) {
        // Maker-checker: an operator's withdrawal is held for an approver.
        setState('pending');
        idemKeyRef.current = null;
      } else {
        setTxHash(data.burnTxHash ?? data.txHash);
        if (mode === 'bank') {
          setCashoutNote(
            `${Number(data.receiveAmountTzs).toLocaleString()} TZS on the way to ${data.recipientName ?? 'your account'} — ` +
            `${Number(data.burnedTzs).toLocaleString()} nTZS burned (incl. ${Number(data.feeTzs).toLocaleString()} payout fee).`,
          );
        }
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
        <h1 className="text-3xl font-thin text-white mb-2">{isBank ? 'Settle out' : 'Move funds out'}</h1>
        <p className="text-sm text-zinc-500 mb-8">
          {mode === 'bank'
            ? 'Redeem nTZS for shillings. Your nTZS is burned and the TZS is paid to your bank account.'
            : isBank
            ? 'Send the stablecoins you have earned to your own custody, an OTC desk, or another institution.'
            : 'Transfer tokens from your inventory wallet to any address on the same network.'}
        </p>

        <AnimatePresence mode="wait">
          {state === 'unresolved' ? (
            <motion.div key="unresolved" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-amber-500/25 bg-amber-950/20 p-8 text-center">
              <AlertCircle size={32} className="text-amber-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-white mb-1">We could not confirm this one</p>
              <p className="text-sm text-zinc-400 mb-6 leading-relaxed">{errorMsg}</p>
              <a
                href={`${selected.explorer}/address/${lp?.walletAddress ?? ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200 transition-colors"
              >
                Check your wallet on the explorer <ExternalLink size={11} />
              </a>
              <br />
              <button onClick={reset} className="mt-6 text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
                Back to withdraw
              </button>
            </motion.div>
          ) : state === 'pending' ? (
            <motion.div key="pending" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-blue-500/20 bg-blue-950/20 p-8 text-center">
              <ShieldCheck size={32} className="text-blue-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-white mb-1">Submitted for approval</p>
              <p className="text-sm text-zinc-500 mb-6">An approver on your team must authorise this withdrawal before it’s sent.</p>
              <button onClick={reset} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Make another request</button>
            </motion.div>
          ) : state === 'success' ? (
            <motion.div key="success" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-8 text-center">
              <CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-white mb-1">
                {mode === 'bank' ? 'Cash-out dispatched' : 'Withdrawal confirmed'}
              </p>
              <p className="text-sm text-zinc-500 mb-6">
                {mode === 'bank'
                  ? cashoutNote || 'Your nTZS was burned and the payout is on its way.'
                  : `Your transaction has been included on ${networkLabel}.`}
              </p>
              {txHash && (
                <a
                  // A cash-out burn is always on Base; a token withdrawal
                  // follows whichever chain the LP selected.
                  href={`${mode === 'bank' ? 'https://basescan.org' : selected.explorer}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors mb-6"
                >
                  View {mode === 'bank' ? 'the burn' : ''} on {mode === 'bank' || selected.chain !== 'bnb' ? 'Basescan' : 'BscScan'} <ExternalLink size={11} />
                </a>
              )}
              <br />
              <button onClick={reset} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
                {mode === 'bank' ? 'Make another cash-out' : 'Make another withdrawal'}
              </button>
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
              {isBank && (
                <div className="mb-6 flex w-fit flex-wrap gap-2 rounded-xl border border-white/5 bg-zinc-950 p-1">
                  {([
                    { id: 'bank', label: 'Settle to shillings' },
                    { id: 'crypto', label: 'Send stablecoin' },
                  ] as const).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setModeChoice(m.id); reset(); }}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                        mode === m.id
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}

              {mode === 'crypto' && (
              <div className="flex flex-wrap gap-2 mb-6 p-1 bg-zinc-950 border border-white/5 rounded-xl w-fit">
                {tokens.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => { setTokenChoice(t); reset(); }}
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
              )}

              <div className="rounded-2xl border border-white/5 bg-zinc-950 p-6 space-y-4">
                {mode === 'crypto' && (
                <div className="flex items-center justify-between text-xs text-zinc-600">
                  <span>Network</span>
                  <span className={`px-2 py-0.5 rounded-full border ${selected.chain === 'bnb' ? 'border-yellow-500/20 text-yellow-400 bg-yellow-950/20' : 'border-blue-500/20 text-blue-400 bg-blue-950/20'}`}>
                    {networkLabel}
                  </span>
                </div>
                )}

                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-zinc-600 mb-2">
                    {mode === 'bank' ? 'Amount to receive' : 'Amount'}
                  </label>
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
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-500 pointer-events-none">{mode === 'bank' ? 'TZS' : selected.id.toUpperCase()}</span>
                  </div>
                </div>

                {relevantDestinations.length > 0 && (
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Destination</label>
                    <SelectMenu
                      ariaLabel="Saved destination"
                      value={destinationId}
                      onChange={pickDestination}
                      options={[
                        ...relevantDestinations.map((d) => ({
                          value: d.id,
                          label: d.kind === 'crypto'
                            ? `${d.label} — ${(d.address ?? '').slice(0, 8)}…${(d.address ?? '').slice(-4)}`
                            : `${d.label} — ${d.bankCode} ${d.accountNumber}`,
                        })),
                        { value: NEW_DESTINATION, label: mode === 'bank' ? 'Another account…' : 'Another address…' },
                      ]}
                    />
                  </div>
                )}

                {mode === 'bank' ? (
                  <>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Bank</label>
                      <SelectMenu
                        ariaLabel="Bank"
                        value={effectiveBankCode}
                        onChange={setBankCode}
                        options={
                          // A saved destination can outlive its bank's presence
                          // in the payout registry; showing the bare code is
                          // honest, where a placeholder would read as unset.
                          effectiveBankCode && !banks.some((b) => b.code === effectiveBankCode)
                            ? [...banks.map((b) => ({ value: b.code, label: b.name })), { value: effectiveBankCode, label: `${effectiveBankCode} (no longer payable)` }]
                            : banks.map((b) => ({ value: b.code, label: b.name }))
                        }
                        placeholder={banks.length === 0 ? 'Bank payouts unavailable' : 'Choose your bank'}
                        disabled={banks.length === 0 || !!chosen}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Account number</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Your settlement account"
                        value={effectiveAccount}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        readOnly={!!chosen}
                        className={`w-full rounded-lg border border-white/8 bg-black/40 px-4 py-3 text-sm font-mono placeholder-zinc-700 focus:outline-none focus:border-blue-500/40 transition-colors ${chosen ? 'text-zinc-500' : 'text-white'}`}
                      />
                    </div>
                  </>
                ) : (
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Destination address</label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={effectiveToAddress}
                    onChange={(e) => setToAddress(e.target.value)}
                    readOnly={!!chosen}
                    className={`w-full rounded-lg border border-white/8 bg-black/40 px-4 py-3 text-sm font-mono placeholder-zinc-700 focus:outline-none focus:border-blue-500/40 transition-colors ${chosen ? 'text-zinc-500' : 'text-white'}`}
                  />
                </div>
                )}

                {/* Offered only once the destination is complete and new — a
                    prompt to name something half-typed just gets dismissed. */}
                {!chosen && (mode === 'bank'
                  ? !!bankCode && accountNumber.replace(/\D/g, '').length >= 5
                  : /^0x[a-fA-F0-9]{40}$/.test(toAddress.trim())) && (
                  <div className="rounded-lg border border-white/5 bg-black/30 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        value={saveLabel}
                        onChange={(e) => { setSaveLabel(e.target.value); setSaveError(''); }}
                        placeholder={mode === 'bank' ? 'Name this account' : 'Name this address, e.g. Treasury custody'}
                        maxLength={60}
                        className="min-w-0 flex-1 rounded-lg border border-white/8 bg-black/40 px-3 py-2 text-xs text-white placeholder-zinc-600 focus:border-blue-500/40 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={saveDestination}
                        disabled={!saveLabel.trim()}
                        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 disabled:opacity-40"
                      >
                        <Bookmark size={12} /> Save for next time
                      </button>
                    </div>
                    {saveError && <p className="mt-2 text-xs text-red-400">{saveError}</p>}
                  </div>
                )}

                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-950/20 border border-amber-500/15">
                  <AlertCircle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    {mode === 'bank' ? (
                      <>Cash-outs are irreversible: your nTZS is burned before the payout is sent. A payout fee is
                      added to the burn, so you receive exactly the amount above.</>
                    ) : (
                      <>Withdrawals are irreversible. Send <strong className="text-zinc-300">{selected.label}</strong> only to a{' '}
                      <strong className="text-zinc-300">{networkLabel}</strong> address.</>
                    )}
                  </p>
                </div>

                {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}

                <button
                  disabled={
                    state === 'loading' ||
                    !amount ||
                    (mode === 'bank'
                      ? !effectiveBankCode || effectiveAccount.replace(/\D/g, '').length < 5
                      : !effectiveToAddress)
                  }
                  onClick={handleSubmit}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold transition-colors"
                >
                  {state === 'loading' ? (
                    <><Loader2 size={14} className="animate-spin" /> Sending transaction...</>
                  ) : (
                    <><ArrowUpRight size={14} /> {mode === 'bank' ? 'Cash out to bank' : `Withdraw ${selected.label}`}</>
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
