'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2, Loader2, ArrowRight, ArrowLeft, ShieldCheck,
  Building2, FileText, UploadCloud, Sparkles,
} from 'lucide-react';
import { KYB_DOC_TYPES, stepsFor, type AccountType } from '@/lib/fx/onboarding';

interface StepInfo { key: string; label: string; description: string; index: number }
interface OnboardingState {
  accountType: AccountType;
  step: number;
  total: number;
  complete: boolean;
  status: string;
  kybStatus: string;
  steps: StepInfo[];
}
interface DocState { fileName: string | null; status: string }

const DOT_BG: React.CSSProperties = {
  backgroundImage: 'radial-gradient(circle, rgba(96,165,250,0.12) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
  maskImage: 'radial-gradient(ellipse 80% 60% at 30% 20%, #000 40%, transparent 100%)',
  WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 30% 20%, #000 40%, transparent 100%)',
};

const PILL_PRIMARY =
  'inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-black bg-gradient-to-br from-blue-400 to-blue-600 rounded-full hover:from-blue-300 hover:to-blue-500 transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none';
const PILL_GHOST =
  'inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm text-gray-300 border border-white/10 rounded-full hover:border-white/30 hover:text-white transition-all duration-200';

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-5 w-5 items-center justify-center rounded-full border-2 border-blue-500">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
      </span>
      <span className="text-sm font-semibold tracking-tight text-white">
        Simple<span className="text-blue-400">FX</span>
      </span>
    </div>
  );
}

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-600/10 px-3 py-1">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
      <span className="text-xs font-medium text-blue-400">{children}</span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0" style={DOT_BG} />
      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <Logo />
        <a href="/simplefx/dashboard" className="text-xs text-zinc-600 transition-colors hover:text-zinc-300">
          Skip for now
        </a>
      </header>
      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-6 sm:px-10">{children}</main>
    </div>
  );
}

/** Step rail (left column) — refined vertical progress. */
function StepRail({ steps, step }: { steps: StepInfo[]; step: number }) {
  return (
    <nav className="space-y-1">
      {steps.map((s) => {
        const done = step > s.index;
        const active = step === s.index;
        return (
          <div key={s.key} className="flex items-start gap-3 py-1.5">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-mono ${
                done
                  ? 'border-blue-500/40 bg-blue-600/20 text-blue-300'
                  : active
                  ? 'border-blue-400 text-blue-400'
                  : 'border-white/10 text-zinc-600'
              }`}
            >
              {done ? <CheckCircle2 size={12} /> : s.index}
            </span>
            <span className={`text-sm leading-5 ${active ? 'text-white' : done ? 'text-zinc-400' : 'text-zinc-600'}`}>
              {s.label}
            </span>
          </div>
        );
      })}
    </nav>
  );
}

/** The KYB upload step — the heart of bank onboarding. */
function KybUpload({ onDone }: { onDone: () => void }) {
  const [docs, setDocs] = useState<Record<string, DocState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [reviewNote, setReviewNote] = useState<string | null>(null);

  useEffect(() => {
    fetch('/simplefx/api/lp/kyb/documents')
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((d: { documents: { docType: string; fileName: string | null; status: string }[]; reviewNote?: string | null }) => {
        const map: Record<string, DocState> = {};
        for (const doc of d.documents) map[doc.docType] = { fileName: doc.fileName, status: doc.status };
        setDocs(map);
        setReviewNote(d.reviewNote ?? null);
      })
      .catch(() => {});
  }, []);

  const upload = async (docType: string, file: File | undefined) => {
    if (!file) return;
    setError('');
    setBusy(docType);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('docType', docType);
      const res = await fetch('/simplefx/api/lp/kyb/documents', { method: 'POST', body: fd });
      let data: { error?: string } | null = null;
      try { data = await res.json(); } catch { /* non-JSON (e.g. a raw 500) */ }
      if (!res.ok) {
        setError(data?.error || `Upload failed (HTTP ${res.status}). Please try again.`);
      } else {
        setDocs((prev) => ({ ...prev, [docType]: { fileName: file.name, status: 'submitted' } }));
      }
    } catch (e) {
      setError('Network error: ' + (e instanceof Error ? e.message : 'request failed'));
    }
    setBusy(null);
  };

  const uploaded = KYB_DOC_TYPES.filter((d) => docs[d.key]).length;
  const allDone = uploaded === KYB_DOC_TYPES.length;

  return (
    <div className="space-y-5">
      {reviewNote && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
          <p className="text-sm font-medium text-amber-200">More information requested</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-200/80">{reviewNote}</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {KYB_DOC_TYPES.map((doc, i) => {
          const have = docs[doc.key];
          const loading = busy === doc.key;
          return (
            <label
              key={doc.key}
              className={`fx-fade-up fx-delay-${Math.min(i + 1, 4)} group relative flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors ${
                have ? 'border-blue-500/30 bg-blue-600/5' : 'border-white/10 bg-white/[0.02] hover:border-white/25'
              }`}
            >
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                disabled={loading}
                onChange={(e) => upload(doc.key, e.target.files?.[0])}
              />
              <div className="flex items-start justify-between">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                    have ? 'bg-blue-600/15 text-blue-400' : 'bg-zinc-900 text-zinc-600 group-hover:text-zinc-400'
                  }`}
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : have ? <CheckCircle2 size={16} /> : <FileText size={16} />}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-700">
                  {have ? 'Uploaded' : 'Required'}
                </span>
              </div>
              <div>
                <p className={`text-sm font-medium ${have ? 'text-white' : 'text-zinc-200'}`}>{doc.label}</p>
                <p className="mt-0.5 truncate text-xs text-zinc-600">{have?.fileName || doc.hint}</p>
              </div>
              <span className={`mt-auto inline-flex items-center gap-1.5 text-xs font-medium ${have ? 'text-blue-400' : 'text-zinc-500 group-hover:text-blue-400'}`}>
                <UploadCloud size={13} /> {have ? 'Replace file' : 'Upload PDF / image'}
              </span>
            </label>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-zinc-600">
          <span className="text-zinc-400">{uploaded}</span> of {KYB_DOC_TYPES.length} documents uploaded · reviewed by our team within 1–2 business days
        </p>
        <button onClick={onDone} disabled={!allDone} className={PILL_PRIMARY}>
          Continue <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-zinc-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-blue-500/40 focus:outline-none"
      />
    </label>
  );
}

/** Banking & reserve step — trust account + settlement details → bankingProfile. */
function BankingStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [form, setForm] = useState({ bankName: '', trustAccountRef: '', swift: '', contactName: '', contactEmail: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/simplefx/api/lp/banking')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { banking?: Partial<typeof form> | null } | null) => { if (d?.banking) setForm((f) => ({ ...f, ...d.banking })); })
      .catch(() => {});
  }, []);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setError('');
    if (!form.bankName.trim() || !form.trustAccountRef.trim()) {
      setError('Partner bank and trust account reference are required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/simplefx/api/lp/banking', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(d?.error || 'Could not save. Please try again.');
      } else { onDone(); }
    } catch { setError('Network error. Please try again.'); }
    setSaving(false);
  };

  return (
    <div className="max-w-md space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Partner bank" value={form.bankName} onChange={(v) => set('bankName', v)} placeholder="e.g. CRDB Bank" />
        <Field label="SWIFT / BIC" value={form.swift} onChange={(v) => set('swift', v)} placeholder="Optional" />
      </div>
      <Field label="Trust / escrow account reference" value={form.trustAccountRef} onChange={(v) => set('trustAccountRef', v)} placeholder="Account number or reference" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Settlement contact" value={form.contactName} onChange={(v) => set('contactName', v)} placeholder="Name" />
        <Field label="Contact email" value={form.contactEmail} onChange={(v) => set('contactEmail', v)} placeholder="ops@bank.com" type="email" />
      </div>
      <p className="text-xs leading-relaxed text-zinc-600">Your reserves stay in this ring-fenced account at your own bank — NEDA never holds your funds.</p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-3 pt-1">
        <button onClick={onBack} className={PILL_GHOST}><ArrowLeft size={15} /> Back</button>
        <button onClick={save} disabled={saving} className={PILL_PRIMARY}>Save &amp; continue <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}

/** FX configuration step — spread (bps) + optional exposure limits. */
function FxStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [bidBps, setBidBps] = useState('120');
  const [askBps, setAskBps] = useState('150');
  const [maxNtzs, setMaxNtzs] = useState('');
  const [maxUsd, setMaxUsd] = useState('');
  const [perTxn, setPerTxn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/simplefx/api/lp/fx-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { bidBps?: number; askBps?: number; limits?: { maxInventoryNtzs?: number; maxInventoryUsd?: number; perTxnCapUsd?: number } | null } | null) => {
        if (!d) return;
        if (typeof d.bidBps === 'number') setBidBps(String(d.bidBps));
        if (typeof d.askBps === 'number') setAskBps(String(d.askBps));
        if (d.limits) {
          setMaxNtzs(d.limits.maxInventoryNtzs?.toString() ?? '');
          setMaxUsd(d.limits.maxInventoryUsd?.toString() ?? '');
          setPerTxn(d.limits.perTxnCapUsd?.toString() ?? '');
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setError('');
    const bid = Number(bidBps), ask = Number(askBps);
    if (!(bid >= 10 && bid <= 500 && ask >= 10 && ask <= 500)) {
      setError('Bid and ask spread must each be between 10 and 500 bps.');
      return;
    }
    setSaving(true);
    try {
      const limits = {
        maxInventoryNtzs: maxNtzs ? Number(maxNtzs) : undefined,
        maxInventoryUsd: maxUsd ? Number(maxUsd) : undefined,
        perTxnCapUsd: perTxn ? Number(perTxn) : undefined,
      };
      const res = await fetch('/simplefx/api/lp/fx-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidBps: bid, askBps: ask, limits }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(d?.error || 'Could not save. Please try again.');
      } else { onDone(); }
    } catch { setError('Network error. Please try again.'); }
    setSaving(false);
  };

  return (
    <div className="max-w-md space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bid spread (bps)" value={bidBps} onChange={setBidBps} type="number" />
        <Field label="Ask spread (bps)" value={askBps} onChange={setAskBps} type="number" />
      </div>
      <p className="text-xs text-zinc-600">Your FX margin on each side of a swap — 100 bps = 1%. You can change it anytime.</p>
      <div className="grid grid-cols-1 gap-3 border-t border-white/5 pt-4 sm:grid-cols-3">
        <Field label="Max nTZS inventory" value={maxNtzs} onChange={setMaxNtzs} type="number" placeholder="Optional" />
        <Field label="Max USD inventory" value={maxUsd} onChange={setMaxUsd} type="number" placeholder="Optional" />
        <Field label="Per-trade cap (USD)" value={perTxn} onChange={setPerTxn} type="number" placeholder="Optional" />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-3 pt-1">
        <button onClick={onBack} className={PILL_GHOST}><ArrowLeft size={15} /> Back</button>
        <button onClick={save} disabled={saving} className={PILL_PRIMARY}>Save &amp; continue <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}

interface Member { id: string; email: string; role: string; status: string }

/** Team & roles step — invite operators/approvers (maker-checker). */
function TeamStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [yourRole, setYourRole] = useState('owner');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'operator' | 'approver' | 'viewer'>('approver');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    fetch('/simplefx/api/lp/members')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { members?: Member[]; you?: { role?: string } } | null) => {
        if (d?.members) setMembers(d.members);
        if (d?.you?.role) setYourRole(d.you.role);
      })
      .catch(() => {});

  useEffect(() => { load(); }, []);

  const invite = async () => {
    setError('');
    if (!email.includes('@')) { setError('Enter a valid email.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/simplefx/api/lp/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) setError(d?.error || 'Could not send the invite.');
      else { setEmail(''); await load(); }
    } catch { setError('Network error. Please try again.'); }
    setBusy(false);
  };

  const remove = async (memberId: string) => {
    setBusy(true);
    try {
      await fetch('/simplefx/api/lp/members', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId }) });
      await load();
    } catch { /* ignore */ }
    setBusy(false);
  };

  const canManage = yourRole === 'owner';

  return (
    <div className="max-w-md space-y-5">
      <div className="space-y-2">
        {members.filter((m) => m.status !== 'disabled').map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-200">{m.email}</p>
              <p className="text-[11px] text-zinc-600">{m.role}{m.status === 'invited' ? ' · invited' : ''}</p>
            </div>
            {canManage && m.role !== 'owner' ? (
              <button onClick={() => remove(m.id)} disabled={busy} className="shrink-0 text-xs text-zinc-600 transition-colors hover:text-red-400">Remove</button>
            ) : (
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-700">{m.role === 'owner' ? 'You' : ''}</span>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs leading-relaxed text-zinc-500">
            Operators set FX and initiate; approvers authorise. Add an approver for dual control — money-moving actions then need a second person’s sign-off.
          </p>
          <Field label="Email" value={email} onChange={setEmail} placeholder="teammate@bank.com" type="email" />
          <label className="block">
            <span className="mb-1.5 block text-xs text-zinc-500">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'operator' | 'approver' | 'viewer')}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white focus:border-blue-500/40 focus:outline-none"
            >
              <option value="operator">Operator — sets FX, initiates</option>
              <option value="approver">Approver — authorises</option>
              <option value="viewer">Viewer — read-only</option>
            </select>
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button onClick={invite} disabled={busy} className={PILL_PRIMARY}>Send invite</button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={onBack} className={PILL_GHOST}><ArrowLeft size={15} /> Back</button>
        <button onClick={onDone} className={PILL_PRIMARY}>Continue <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/simplefx/api/lp/onboarding');
    if (!res.ok) {
      // Not signed in → sign in, then return here (banks arriving from the landing CTA).
      router.replace('/simplefx?next=' + encodeURIComponent('/simplefx/onboarding'));
      return;
    }
    setState(await res.json());
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (state?.complete) router.replace('/simplefx/dashboard');
  }, [state?.complete, router]);

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    const res = await fetch('/simplefx/api/lp/onboarding', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) setState(await res.json());
    setSaving(false);
  };

  if (!state || state.complete) {
    return (
      <Shell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="animate-spin text-blue-400" />
        </div>
      </Shell>
    );
  }

  // ── Account-type fork ─────────────────────────────────────────────────────
  if (state.accountType !== 'bank') {
    const choose = (type: AccountType) =>
      type === 'standard' ? router.replace('/simplefx/dashboard') : patch({ accountType: 'bank', step: 1 });
    return (
      <Shell>
        <div className="mx-auto max-w-2xl pt-10 text-center">
          <div className="fx-fade-up flex justify-center">
            <StatusPill>Become a liquidity provider</StatusPill>
          </div>
          <h1 className="fx-fade-up fx-delay-1 mt-6 text-4xl font-bold leading-none tracking-tight fx-gradient-text sm:text-5xl">
            How will you provide<br />liquidity?
          </h1>
          <p className="fx-fade-up fx-delay-2 mx-auto mt-5 max-w-md text-base leading-relaxed text-gray-400">
            Choose how you want to onboard. You can change this later with our team.
          </p>
          <div className="mt-10 grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
            <div
              aria-disabled
              className="fx-fade-up fx-delay-3 relative flex cursor-not-allowed flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6 opacity-60"
            >
              <span className="absolute right-4 top-4 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Coming soon
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-zinc-600">
                <Sparkles size={18} />
              </span>
              <div>
                <p className="text-base font-medium text-zinc-300">Standard LP</p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-600">
                  Self-serve liquidity provision. Available soon.
                </p>
              </div>
              <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600">
                Coming soon
              </span>
            </div>
            <button
              onClick={() => choose('bank')}
              className="fx-fade-up fx-delay-4 group flex flex-col gap-4 rounded-2xl border border-blue-500/30 bg-blue-600/[0.06] p-6 transition-colors hover:border-blue-400/50"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/15 text-blue-400">
                <Building2 size={18} />
              </span>
              <div>
                <p className="text-base font-medium text-white">Bank / Institution</p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                  Guided onboarding with KYB, reserve setup, and FX configuration.
                </p>
              </div>
              <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-blue-400">
                Start onboarding <ArrowRight size={14} />
              </span>
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Bank wizard ───────────────────────────────────────────────────────────
  const steps = stepsFor('bank').map((s, i) => ({ ...s, index: i + 1 }));
  const current = steps[state.step - 1] ?? steps[0];
  const next = () => patch({ step: state.step + 1 });
  const back = () => patch({ step: Math.max(1, state.step - 1) });

  return (
    <Shell>
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Left — hero + rail */}
        <div>
          <div className="fx-fade-up">
            <StatusPill>Bank onboarding · step {state.step} of {state.total}</StatusPill>
          </div>
          <h1 className="fx-fade-up fx-delay-1 mt-5 text-3xl font-bold leading-tight tracking-tight fx-gradient-text">
            {current.label}
          </h1>
          <p className="fx-fade-up fx-delay-2 mt-3 max-w-xs text-sm leading-relaxed text-gray-400">
            {current.description}
          </p>
          <div className="fx-fade-up fx-delay-3 mt-8 border-t border-white/5 pt-6">
            <StepRail steps={steps} step={state.step} />
          </div>
        </div>

        {/* Right — step content */}
        <div className="fx-fade-up fx-delay-2 lg:pt-1">
          {current.key === 'kyb' ? (
            <KybUpload onDone={next} />
          ) : current.key === 'banking' ? (
            <BankingStep onDone={next} onBack={back} />
          ) : current.key === 'fx' ? (
            <FxStep onDone={next} onBack={back} />
          ) : current.key === 'team' ? (
            <TeamStep onDone={next} onBack={back} />
          ) : current.key === 'profile' ? (
            <div className="max-w-md space-y-5">
              <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-blue-400" />
                <p className="text-sm leading-relaxed text-zinc-400">
                  You’re onboarding as a <span className="text-white">bank partner</span>. Next you’ll submit KYB
                  documents, set up your reserve account, and configure FX — all under your control.
                </p>
              </div>
              <button onClick={next} disabled={saving} className={PILL_PRIMARY}>
                Begin <ArrowRight size={15} />
              </button>
            </div>
          ) : (
            <div className="max-w-md space-y-5">
              <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <Sparkles size={18} className="mt-0.5 shrink-0 text-blue-400" />
                <p className="text-sm leading-relaxed text-zinc-400">
                  <span className="text-white">{current.label}</span> — {current.description} This step opens once our
                  team has reviewed your earlier submissions.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={back} disabled={saving} className={PILL_GHOST}>
                  <ArrowLeft size={15} /> Back
                </button>
                <button onClick={next} disabled={saving} className={PILL_PRIMARY}>
                  Continue <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
