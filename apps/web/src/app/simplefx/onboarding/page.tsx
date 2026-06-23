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
interface DocState { fileName: string | null; fileUrl: string; status: string }

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

  useEffect(() => {
    fetch('/simplefx/api/lp/kyb/documents')
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((d: { documents: { docType: string; fileName: string | null; fileUrl: string; status: string }[] }) => {
        const map: Record<string, DocState> = {};
        for (const doc of d.documents) map[doc.docType] = { fileName: doc.fileName, fileUrl: doc.fileUrl, status: doc.status };
        setDocs(map);
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
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Upload failed. Please try again.');
      } else {
        setDocs((prev) => ({ ...prev, [docType]: { fileName: file.name, fileUrl: data.fileUrl, status: 'submitted' } }));
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setBusy(null);
  };

  const uploaded = KYB_DOC_TYPES.filter((d) => docs[d.key]).length;
  const allDone = uploaded === KYB_DOC_TYPES.length;

  return (
    <div className="space-y-5">
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

export default function OnboardingPage() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/simplefx/api/lp/onboarding');
    if (!res.ok) {
      router.replace('/simplefx');
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
            <button
              onClick={() => choose('standard')}
              className="fx-fade-up fx-delay-3 group flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition-colors hover:border-white/25"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-zinc-400 group-hover:text-white">
                <Sparkles size={18} />
              </span>
              <div>
                <p className="text-base font-medium text-white">Standard LP</p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-500">
                  Self-serve. Deposit, set your spread, and go live in minutes.
                </p>
              </div>
              <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-zinc-400 group-hover:text-blue-400">
                Continue <ArrowRight size={14} />
              </span>
            </button>
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
