'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowDownToLine, ArrowUpRight, SlidersHorizontal, Zap, Activity,
  Copy, CheckCircle2, ChevronRight,
} from 'lucide-react';
import { useLp } from './layout';

const STEPS = [
  {
    n: 1,
    icon: ArrowDownToLine,
    title: 'Fund your inventory wallet',
    desc: 'Send nTZS to your LP wallet address to start building inventory.',
    cta: 'Go to Deposit',
    href: '/simplefx/dashboard/deposit',
  },
  {
    n: 2,
    icon: SlidersHorizontal,
    title: 'Set your bid and ask spread',
    desc: 'Configure how much you earn on each side of every swap.',
    cta: 'Configure Spread',
    href: '/simplefx/dashboard/spread',
  },
  {
    n: 3,
    icon: Zap,
    title: 'Activate your position',
    desc: 'Go live. Orders will fill against your inventory automatically.',
    cta: 'Activate',
    href: '/simplefx/dashboard/spread',
  },
];

function OnboardingWizard({ currentStep }: { currentStep: number }) {
  return (
    <div className="mb-10">
      <div className="flex items-center gap-2 mb-6">
        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Getting started</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {STEPS.map((step) => {
          const done = currentStep > step.n;
          const active = currentStep === step.n;
          const Icon = step.icon;
          return (
            <motion.div
              key={step.n}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: step.n * 0.08, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className={`relative rounded-xl border p-5 flex flex-col gap-4 transition-colors ${
                done
                  ? 'border-white/5 bg-white/2 opacity-50'
                  : active
                  ? 'border-blue-500/30 bg-blue-600/5'
                  : 'border-white/5 bg-white/2 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  done ? 'bg-zinc-800' : active ? 'bg-blue-600/20' : 'bg-zinc-900'
                }`}>
                  {done
                    ? <CheckCircle2 size={16} className="text-zinc-500" />
                    : <Icon size={16} className={active ? 'text-blue-400' : 'text-zinc-600'} />
                  }
                </div>
                <span className={`text-xs font-mono ${active ? 'text-blue-400' : 'text-zinc-700'}`}>
                  {done ? 'Done' : `Step ${step.n}`}
                </span>
              </div>
              <div>
                <p className={`text-sm font-medium mb-1 ${done ? 'text-zinc-600' : 'text-white'}`}>
                  {step.title}
                </p>
                <p className="text-xs text-zinc-600 leading-relaxed">{step.desc}</p>
              </div>
              {active && (
                <Link
                  href={step.href}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors mt-auto"
                >
                  {step.cta} <ChevronRight size={12} />
                </Link>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/2 p-5">
      <p className="text-xs text-zinc-600 mb-2 uppercase tracking-[0.2em]">{label}</p>
      <p className={`text-2xl font-light tracking-tight ${accent ? 'text-blue-400' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-600 mt-1">{sub}</p>}
    </div>
  );
}

function WalletAddressCard({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-white/5 bg-white/2 p-5">
      <p className="text-xs text-zinc-600 uppercase tracking-[0.2em] mb-3">Your LP Wallet</p>
      <div className="flex items-center gap-3">
        <p className="text-sm text-zinc-400 font-mono flex-1 truncate">{address}</p>
        <button onClick={copy} className="flex-none flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors">
          {copied ? <CheckCircle2 size={14} className="text-blue-400" /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
      isActive
        ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20'
        : 'bg-zinc-900 text-zinc-500 border border-white/5'
    }`}>
      <span className={`w-1 h-1 rounded-full ${isActive ? 'bg-blue-400 animate-pulse' : 'bg-zinc-600'}`} />
      {isActive ? 'Live' : 'Inactive'}
    </span>
  );
}

export default function OverviewPage() {
  const { lp } = useLp();
  const [balances, setBalances] = useState<{ ntzs: string; usdc: string } | null>(null);

  useEffect(() => {
    if (!lp) return;
    fetch('/simplefx/api/lp/balances')
      .then((r) => r.json())
      .then(setBalances)
      .catch(() => {});
  }, [lp?.walletAddress]);

  if (!lp) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-1 h-1 rounded-full bg-zinc-600 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    );
  }

  const isOnboarding = lp.onboardingStep < 4;
  const spreadPct = ((lp.bidBps + lp.askBps) / 2 / 100).toFixed(2);

  const fmt = (v: string | undefined) => {
    if (!v) return '—';
    const n = parseFloat(v);
    if (n === 0) return '0';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-start justify-between mb-10"
      >
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Dashboard</p>
          <h1 className="text-3xl font-thin text-white">{lp.displayName ?? lp.email.split('@')[0]}</h1>
        </div>
        <StatusBadge isActive={lp.isActive} />
      </motion.div>

      {isOnboarding && <OnboardingWizard currentStep={lp.onboardingStep} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="nTZS Inventory" value={fmt(balances?.ntzs)} sub="Base Mainnet" />
        <StatCard label="USDC Balance" value={fmt(balances?.usdc)} sub="Base Mainnet" />
        <StatCard label="Avg Spread" value={`${spreadPct}%`} sub={`Bid ${lp.bidBps}bps / Ask ${lp.askBps}bps`} accent />
        <StatCard label="Total Earnings" value="0 nTZS" sub="All time" />
      </div>

      <div className="mb-6">
        <WalletAddressCard address={lp.walletAddress} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { href: '/simplefx/dashboard/deposit', icon: ArrowDownToLine, label: 'Deposit nTZS' },
          { href: '/simplefx/dashboard/withdraw', icon: ArrowUpRight, label: 'Withdraw' },
          { href: '/simplefx/dashboard/spread', icon: SlidersHorizontal, label: 'Edit Spread' },
          { href: '/simplefx/dashboard/positions', icon: Activity, label: 'View Positions' },
        ].map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center justify-between px-4 py-3 rounded-lg border border-white/5 hover:border-blue-500/30 hover:bg-blue-600/5 transition-all text-sm text-zinc-400 hover:text-white"
          >
            <span className="flex items-center gap-2">
              <Icon size={15} className="text-blue-400" />
              {label}
            </span>
            <ChevronRight size={14} className="text-zinc-700" />
          </Link>
        ))}
      </div>
    </div>
  );
}
