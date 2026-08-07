'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Check, X, Loader2, UserPlus, Trash2, AlertTriangle } from 'lucide-react';

import { SelectMenu } from '../_components/SelectMenu';

interface Member {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

interface Policy {
  thresholdTzs: number | null;
  thresholdUsd: number | null;
  secondApproverCount: number;
  canEdit: boolean;
}

const ROLE_OPTIONS = [
  { value: 'approver', label: 'Approver — can release queued requests' },
  { value: 'operator', label: 'Operator — requests, cannot release' },
  { value: 'viewer', label: 'Viewer — read only' },
];

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', approver: 'Approver', operator: 'Operator', viewer: 'Viewer',
};

const fmtAmount = (n: number) => n.toLocaleString('en-US');

interface Approval {
  id: string;
  action: string;
  payload: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  requestedByMemberId: string | null;
  requesterEmail: string | null;
}

function summarize(action: string, payload: Record<string, unknown> | null): string {
  const p = payload ?? {};
  if (action === 'set_fx') {
    const parts = [`bid ${p.bidBps} bps`, `ask ${p.askBps} bps`];
    if (p.limits) parts.push('limits updated');
    return 'Set FX — ' + parts.join(', ');
  }
  if (action === 'set_banking') {
    const name = typeof p.bankName === 'string' ? p.bankName : 'details';
    const ref = typeof p.trustAccountRef === 'string' ? ` (${p.trustAccountRef})` : '';
    return 'Update banking — ' + name + ref;
  }
  if (action === 'withdraw') {
    // A withdrawal is either an on-chain transfer or a fiat cash-out, and the
    // two carry different payloads. An approver has to see the amount they're
    // releasing, so read whichever shape this one is.
    if (p.method === 'bank') {
      const amt = typeof p.amountTzs === 'number' ? fmtAmount(p.amountTzs) : '';
      const acct = typeof p.accountNumber === 'string' ? p.accountNumber : '';
      const bank = typeof p.bankCode === 'string' ? p.bankCode : 'bank';
      return `Cash out ${amt} nTZS → ${bank} ${acct}`.trim();
    }
    const amt = typeof p.amount === 'string' ? p.amount : '';
    const tok = typeof p.token === 'string' ? p.token.toUpperCase() : '';
    const to = typeof p.toAddress === 'string' ? `${p.toAddress.slice(0, 8)}…${p.toAddress.slice(-4)}` : '';
    return `Withdraw ${amt} ${tok} → ${to}`;
  }
  return action;
}

/**
 * Who can act, and who can release.
 *
 * Two roles matter for maker-checker: an operator's actions always queue, and
 * an approver is who releases them. A checker cannot approve their own
 * request, so an account with one approver and a threshold set can queue work
 * that nobody is able to release — hence the warning below the threshold.
 */
function TeamSection({ onChanged }: { onChanged: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [you, setYou] = useState<{ memberId: string | null; role: string }>({ memberId: null, role: 'owner' });
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('approver');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/simplefx/api/lp/members');
      const d = await res.json();
      setMembers((d.members ?? []) as Member[]);
      if (d.you) setYou(d.you);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const isOwner = !you.role || you.role === 'owner';

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      const res = await fetch('/simplefx/api/lp/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) setError(d?.error || 'Could not send the invite.');
      else {
        setNotice(`Invited ${email.trim()} — they get access on first sign-in.`);
        setEmail('');
        await load();
        onChanged();
      }
    } catch { setError('Network error. Please try again.'); }
    setBusy(false);
  };

  const remove = async (m: Member) => {
    setError(''); setNotice(''); setRemoving(m.id);
    try {
      const res = await fetch('/simplefx/api/lp/members', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: m.id }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) setError(d?.error || 'Could not remove that member.');
      else { await load(); onChanged(); }
    } catch { setError('Network error. Please try again.'); }
    setRemoving(null);
  };

  const active = members.filter((m) => m.status !== 'disabled');

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium text-white">Team</h2>
      <p className="mt-1 text-xs text-zinc-600">
        Operators raise requests; approvers and the owner release them. Nobody can approve their own request.
      </p>

      <div className="mt-4 rounded-2xl border border-white/5 bg-zinc-950">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 size={16} className="animate-spin text-blue-400" /></div>
        ) : (
          <ul className="divide-y divide-white/5">
            {active.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{m.email}</p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {ROLE_LABEL[m.role] ?? m.role}
                    {m.status === 'invited' && ' · invite pending'}
                    {m.id === you.memberId && ' · you'}
                  </p>
                </div>
                {isOwner && m.role !== 'owner' && (
                  <button
                    onClick={() => remove(m)}
                    disabled={removing === m.id}
                    aria-label={`Remove ${m.email}`}
                    className="shrink-0 rounded-lg p-2 text-zinc-600 transition-colors hover:bg-white/5 hover:text-red-400 disabled:opacity-40"
                  >
                    {removing === m.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {isOwner && (
          <form onSubmit={invite} className="flex flex-col gap-3 border-t border-white/5 p-5 sm:flex-row sm:items-center">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@bank.co.tz"
              className="min-w-0 flex-1 rounded-lg border border-white/8 bg-black/40 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:border-blue-500/40 focus:outline-none"
            />
            <div className="sm:w-72">
              <SelectMenu value={role} onChange={setRole} options={ROLE_OPTIONS} ariaLabel="Role" searchable={false} />
            </div>
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Invite
            </button>
          </form>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {notice && <p className="mt-3 text-sm text-emerald-400">{notice}</p>}
    </section>
  );
}

/**
 * The value ceilings: at or above one, even an owner's withdrawal queues.
 *
 * Two of them, because a ceiling only means anything against its own currency.
 * A shilling cash-out is measured in nTZS; a stablecoin transfer — a bank
 * moving card-scheme float, say — is measured in dollars. Converting one to
 * the other would need a live rate inside a control path, where a failed
 * lookup silently disarms the limit.
 */
function ThresholdSection({ policy, reload }: { policy: Policy | null; reload: () => void }) {
  // null = untouched, so a field follows whatever the server last told us —
  // including right after a save, without an effect to copy it across.
  const [tzsDraft, setTzsDraft] = useState<string | null>(null);
  const [usdDraft, setUsdDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  if (!policy) return null;

  const read = (draft: string | null, saved: number | null) => {
    const shown = draft ?? (saved ? String(saved) : '');
    const digits = shown.replace(/[^\d]/g, '');
    return { shown, parsed: digits === '' ? null : Number(digits) };
  };
  const tzs = read(tzsDraft, policy.thresholdTzs);
  const usd = read(usdDraft, policy.thresholdUsd);
  const dirty = tzs.parsed !== policy.thresholdTzs || usd.parsed !== policy.thresholdUsd;
  const anySet = (tzs.parsed ?? 0) > 0 || (usd.parsed ?? 0) > 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSaved(false); setBusy(true);
    try {
      const res = await fetch('/simplefx/api/lp/approval-policy', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thresholdTzs: tzs.parsed, thresholdUsd: usd.parsed }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) setError(d?.error || 'Could not save the thresholds.');
      else { setSaved(true); setTzsDraft(null); setUsdDraft(null); reload(); }
    } catch { setError('Network error. Please try again.'); }
    setBusy(false);
  };

  const field = (
    id: 'tzs' | 'usd',
    value: string,
    onChange: (v: string) => void,
    unit: string,
    hint: string,
  ) => (
    <div key={id}>
      <label className="mb-2 block text-[10px] uppercase tracking-widest text-zinc-600">{hint}</label>
      <div className="relative">
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => { onChange(e.target.value); setSaved(false); }}
          disabled={!policy.canEdit}
          placeholder="No threshold"
          className="w-full rounded-lg border border-white/8 bg-black/40 px-4 py-3 pr-16 text-sm text-white placeholder-zinc-600 focus:border-blue-500/40 focus:outline-none disabled:cursor-not-allowed disabled:text-zinc-500"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-600">{unit}</span>
      </div>
    </div>
  );

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium text-white">Approval thresholds</h2>
      <p className="mt-1 text-xs text-zinc-600">
        Withdrawals at or above these amounts wait for a second sign-off, whoever raised them. Leave either blank to
        rely on roles alone for that currency.
      </p>

      <div className="mt-4 rounded-2xl border border-white/5 bg-zinc-950 p-5">
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {field('tzs', tzs.shown, (v) => setTzsDraft(v), 'nTZS', 'Shilling cash-outs')}
            {field('usd', usd.shown, (v) => setUsdDraft(v), 'USD', 'Stablecoin transfers')}
          </div>
          {policy.canEdit && (
            <button
              type="submit"
              disabled={busy || !dirty}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
            </button>
          )}
        </form>

        {anySet && (
          <p className="mt-3 text-xs text-zinc-500">
            {[
              tzs.parsed ? `${fmtAmount(tzs.parsed)} nTZS` : null,
              usd.parsed ? `$${fmtAmount(usd.parsed)}` : null,
            ].filter(Boolean).join(' and ')} and up needs a second approver.
          </p>
        )}

        {/* A ceiling with nobody else to release it parks funds indefinitely. */}
        {anySet && policy.secondApproverCount === 0 && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
            <p className="text-xs leading-relaxed text-amber-200/80">
              Nobody on this account can approve these yet. Because a request can&apos;t be released by the person who
              raised it, anything at or above these amounts will sit pending. Invite a second approver below first.
            </p>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {saved && !error && <p className="mt-3 text-sm text-emerald-400">Thresholds saved.</p>}
      </div>
    </section>
  );
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [canDecide, setCanDecide] = useState(false);
  const [youMemberId, setYouMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [policy, setPolicy] = useState<Policy | null>(null);

  const loadPolicy = useCallback(async () => {
    try {
      const res = await fetch('/simplefx/api/lp/approval-policy');
      if (res.ok) setPolicy((await res.json()) as Policy);
    } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/simplefx/api/lp/approvals');
      const d = await res.json();
      setApprovals((d.approvals ?? []) as Approval[]);
      setCanDecide(!!d.you?.canDecide);
      setYouMemberId(d.you?.memberId ?? null);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); loadPolicy(); }, [load, loadPolicy]);

  const decide = async (approvalId: string, decision: 'approve' | 'reject') => {
    setError('');
    setBusy(approvalId);
    try {
      const res = await fetch('/simplefx/api/lp/approvals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approvalId, decision }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) setError(d?.error || 'Could not record the decision.');
      else await load();
    } catch { setError('Network error. Please try again.'); }
    setBusy(null);
  };

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mb-8">
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Maker-checker</p>
        <h1 className="text-3xl font-thin text-white">Approvals</h1>
        <p className="mt-2 text-sm text-zinc-500">Requests that need a second sign-off before they take effect — from operators, or from anyone over your threshold.</p>
      </motion.div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-blue-400" /></div>
      ) : approvals.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-zinc-950 p-10 text-center">
          <ShieldCheck size={28} className="mx-auto mb-3 text-zinc-700" />
          <p className="text-sm text-zinc-500">No pending approvals.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => {
            // You can always take back your own request; you just can't release it.
            const isYours = !!a.requestedByMemberId && a.requestedByMemberId === youMemberId;
            return (
            <div key={a.id} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-zinc-950 p-5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">{summarize(a.action, a.payload)}</p>
                <p className="mt-0.5 text-xs text-zinc-600">
                  Requested by {isYours ? 'you' : a.requesterEmail ?? 'a teammate'} · {new Date(a.createdAt).toLocaleString()}
                </p>
                {isYours && (
                  <p className="mt-1.5 text-xs text-amber-400/70">Waiting on another approver — you can&apos;t release your own request.</p>
                )}
              </div>
              {canDecide && (
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => decide(a.id, 'reject')} disabled={busy === a.id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-white/10 disabled:opacity-40">
                    {busy === a.id && isYours ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                    {isYours ? 'Cancel' : 'Reject'}
                  </button>
                  {!isYours && (
                    <button onClick={() => decide(a.id, 'approve')} disabled={busy === a.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">
                      {busy === a.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve
                    </button>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      <ThresholdSection policy={policy} reload={loadPolicy} />
      <TeamSection onChanged={loadPolicy} />
    </div>
  );
}
