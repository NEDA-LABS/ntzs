'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Check, X, Loader2 } from 'lucide-react';

interface Approval {
  id: string;
  action: string;
  payload: Record<string, unknown> | null;
  status: string;
  createdAt: string;
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
    const amt = typeof p.amount === 'string' ? p.amount : '';
    const tok = typeof p.token === 'string' ? p.token.toUpperCase() : '';
    const to = typeof p.toAddress === 'string' ? `${p.toAddress.slice(0, 8)}…${p.toAddress.slice(-4)}` : '';
    return `Withdraw ${amt} ${tok} → ${to}`;
  }
  return action;
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [canDecide, setCanDecide] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/simplefx/api/lp/approvals');
      const d = await res.json();
      setApprovals((d.approvals ?? []) as Approval[]);
      setCanDecide(!!d.you?.canDecide);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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
        <p className="mt-2 text-sm text-zinc-500">Pending requests from operators that need a second sign-off before they take effect.</p>
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
          {approvals.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-zinc-950 p-5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">{summarize(a.action, a.payload)}</p>
                <p className="mt-0.5 text-xs text-zinc-600">
                  Requested by {a.requesterEmail ?? 'a teammate'} · {new Date(a.createdAt).toLocaleString()}
                </p>
              </div>
              {canDecide && (
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => decide(a.id, 'reject')} disabled={busy === a.id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-white/10 disabled:opacity-40">
                    <X size={14} /> Reject
                  </button>
                  <button onClick={() => decide(a.id, 'approve')} disabled={busy === a.id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">
                    {busy === a.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
