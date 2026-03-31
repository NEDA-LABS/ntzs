import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface LegalLayoutProps {
  title: string;
  subtitle: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export default function LegalLayout({ title, subtitle, lastUpdated, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Top nav */}
      <div className="sticky top-0 z-10 border-b border-white/5 bg-black/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/simplefx"
            className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-white transition-colors"
          >
            <ArrowLeft size={14} />
            SimpleFX
          </Link>
          <div className="flex items-center gap-4 text-xs text-zinc-600">
            <Link href="/simplefx/docs" className="hover:text-zinc-300 transition-colors">Docs</Link>
            <Link href="/simplefx/terms" className="hover:text-zinc-300 transition-colors">Terms</Link>
            <Link href="/simplefx/privacy" className="hover:text-zinc-300 transition-colors">Privacy</Link>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="border-b border-white/5">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-600 mb-4">{subtitle}</p>
          <h1 className="text-4xl font-thin text-white mb-4">{title}</h1>
          <p className="text-sm text-zinc-600">Last updated: {lastUpdated}</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="prose-legal">
          {children}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white/5 mt-16">
        <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-700">
          <span>NEDA Labs Ltd. — Dar es Salaam, Tanzania</span>
          <div className="flex gap-4">
            <Link href="/simplefx/terms" className="hover:text-zinc-400 transition-colors">Terms</Link>
            <Link href="/simplefx/privacy" className="hover:text-zinc-400 transition-colors">Privacy</Link>
            <Link href="/simplefx/docs" className="hover:text-zinc-400 transition-colors">Docs</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
