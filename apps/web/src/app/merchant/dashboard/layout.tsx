'use client';

import { useState, useEffect, createContext, useContext } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Link2, Clock, Settings, LogOut, Menu, X } from 'lucide-react';
import { AiAssistant, AiAssistantProvider, useAiAssistant } from './_components/AiAssistant';

export interface MerchantAccount {
  id: string;
  email: string;
  businessName: string | null;
  handle: string;
  walletAddress: string;
  settlePct: number;
  settlementPhone: string | null;
  isActive: boolean;
  onboardingStep: number;
  createdAt: string;
  hasPassword: boolean;
}

export type PortalTheme = 'dark' | 'midnight' | 'forest' | 'slate' | 'rose' | 'jade' | 'light' | 'pink';
export type PortalFont  = 'mono' | 'sans' | 'round';

interface MerchantCtx {
  merchant: MerchantAccount | null;
  refresh: () => Promise<void>;
  theme: PortalTheme;
  setTheme: (t: PortalTheme) => void;
  font: PortalFont;
  setFont: (f: PortalFont) => void;
}

const Ctx = createContext<MerchantCtx>({
  merchant: null,
  refresh: async () => {},
  theme: 'dark',
  setTheme: () => {},
  font: 'mono',
  setFont: () => {},
});
export const useMerchant = () => useContext(Ctx);

const THEME_STYLES: Record<PortalTheme, { root: string; sidebar: string; border: string; mobilebar: string; navActive: string }> = {
  dark:     { root: 'bg-black',        sidebar: 'bg-black',        border: 'border-white/10',          mobilebar: 'bg-black',        navActive: 'border-l border-emerald-400 pl-[11px] text-emerald-400 bg-emerald-500/5' },
  midnight: { root: 'bg-[#0a0f1a]',    sidebar: 'bg-[#0d1424]',    border: 'border-[#1e2d4a]',         mobilebar: 'bg-[#0d1424]',    navActive: 'border-l border-emerald-400 pl-[11px] text-emerald-400 bg-emerald-500/5' },
  forest:   { root: 'bg-[#020a04]',    sidebar: 'bg-[#030d06]',    border: 'border-emerald-950',        mobilebar: 'bg-[#030d06]',    navActive: 'border-l border-emerald-400 pl-[11px] text-emerald-400 bg-emerald-500/5' },
  slate:    { root: 'bg-[#0e0f11]',    sidebar: 'bg-[#141518]',    border: 'border-white/[0.07]',       mobilebar: 'bg-[#141518]',    navActive: 'border-l border-emerald-400 pl-[11px] text-emerald-400 bg-emerald-500/5' },
  rose:     { root: 'bg-[#0d0508]',    sidebar: 'bg-[#150609]',    border: 'border-rose-900/60',        mobilebar: 'bg-[#150609]',    navActive: 'border-l border-emerald-400 pl-[11px] text-emerald-400 bg-emerald-500/5' },
  jade:     { root: 'bg-[#010c05]',    sidebar: 'bg-[#021608]',    border: 'border-emerald-800/50',     mobilebar: 'bg-[#021608]',    navActive: 'border-l border-emerald-400 pl-[11px] text-emerald-400 bg-emerald-500/5' },
  // Light: dark sidebar, light content area (overrides applied via <style> scoped to main)
  light:    { root: 'bg-zinc-100',     sidebar: 'bg-zinc-900',     border: 'border-zinc-700/60',        mobilebar: 'bg-zinc-900',     navActive: 'border-l border-emerald-400 pl-[11px] text-emerald-400 bg-emerald-500/5' },
  pink:     { root: 'bg-[#fdf0f6]',    sidebar: 'bg-[#1c0010]',    border: 'border-pink-800/50',        mobilebar: 'bg-[#1c0010]',    navActive: 'border-l border-pink-400 pl-[11px] text-pink-400 bg-pink-500/5' },
};

const THEME_SWATCHES: { id: PortalTheme; label: string; swatch: string }[] = [
  { id: 'dark',     label: 'Dark',     swatch: 'bg-zinc-950 border border-white/20' },
  { id: 'midnight', label: 'Midnight', swatch: 'bg-[#0d1424] border border-indigo-500/40' },
  { id: 'forest',   label: 'Forest',   swatch: 'bg-[#030d06] border border-emerald-700/50' },
  { id: 'slate',    label: 'Slate',    swatch: 'bg-[#141518] border border-white/15' },
  { id: 'rose',     label: 'Rose',     swatch: 'bg-[#150609] border border-rose-500/50' },
  { id: 'jade',     label: 'Jade',     swatch: 'bg-[#021608] border border-emerald-400/60' },
  { id: 'light',    label: 'Light',    swatch: 'bg-zinc-100 border border-zinc-400/60' },
  { id: 'pink',     label: 'Pink',     swatch: 'bg-pink-400 border border-pink-200/60' },
];

const NAV = [
  { href: '/merchant/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/merchant/dashboard/links', label: 'Products', icon: Link2 },
  { href: '/merchant/dashboard/collections', label: 'Orders', icon: Clock },
  { href: '/merchant/dashboard/settings', label: 'Settings', icon: Settings },
];

const FONT_OPTIONS: { id: PortalFont; label: string; style: React.CSSProperties }[] = [
  { id: 'mono',  label: 'Mono',  style: { fontFamily: 'var(--font-geist-mono)' } },
  { id: 'sans',  label: 'Sans',  style: { fontFamily: 'var(--font-poppins)' } },
  { id: 'round', label: 'Round', style: { fontFamily: 'var(--font-montserrat)' } },
];

function Sidebar({
  merchant, onLogout, onClose, theme, setTheme, font, setFont,
}: {
  merchant: MerchantAccount | null;
  onLogout: () => void;
  onClose?: () => void;
  theme: PortalTheme;
  setTheme: (t: PortalTheme) => void;
  font: PortalFont;
  setFont: (f: PortalFont) => void;
}) {
  const pathname = usePathname();
  const s = THEME_STYLES[theme];

  return (
    <aside className={`flex flex-col h-full w-60 ${s.sidebar} border-r ${s.border} font-mono`}>
      {/* Header */}
      <div className={`px-5 py-5 border-b ${s.border}`}>
        <div className="flex items-center justify-between">
          <Link href="/merchant" className="text-white font-bold tracking-widest text-sm uppercase">
            n<span className="text-emerald-400">TZS</span>
          </Link>
          {onClose && (
            <button onClick={onClose} className="text-white/30 hover:text-white transition-colors lg:hidden">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] tracking-widest text-white/30 uppercase">Biashara Portal</span>
        </div>
        {merchant && (
          <>
            <div className={`h-px my-3 border-t ${s.border}`} />
            <p className="text-xs text-white/60 truncate">{merchant.businessName || `@${merchant.handle}`}</p>
            <p className="text-[10px] text-white/25 tracking-wide truncate mt-0.5">{merchant.email}</p>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 text-xs tracking-wide transition-colors ${
                active
                  ? s.navActive
                  : 'text-white/35 hover:text-white/70 hover:bg-white/[0.03]'
              }`}
            >
              <Icon size={13} />
              <span className="uppercase tracking-wider">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Theme + Font switcher */}
      <div className={`px-5 py-4 border-t ${s.border} space-y-3`}>
        <div>
          <p className="text-[9px] tracking-widest text-white/25 uppercase mb-2.5">Theme</p>
          <div className="grid grid-cols-4 gap-1.5">
            {THEME_SWATCHES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                title={t.label}
                className={`w-5 h-5 transition-all ${t.swatch} ${
                  theme === t.id
                    ? 'ring-2 ring-offset-1 ring-white/40 opacity-100'
                    : 'opacity-35 hover:opacity-65'
                }`}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="text-[9px] tracking-widest text-white/25 uppercase mb-2">Font</p>
          <div className="flex gap-1.5">
            {FONT_OPTIONS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFont(f.id)}
                title={f.label}
                style={f.style}
                className={`flex-1 py-1 text-xs border transition-all ${
                  font === f.id
                    ? 'border-white/40 text-white bg-white/10'
                    : 'border-white/10 text-white/30 hover:text-white/50 hover:border-white/20'
                }`}
              >
                Aa
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Ubongo AI shortcut */}
      <AiSidebarButton />

      {/* Sign out */}
      <div className="px-3 pb-4">
        <button
          onClick={onLogout}
          className="flex items-center gap-3 px-3 py-2.5 text-xs tracking-wide text-white/25 hover:text-white/50 hover:bg-white/[0.03] transition-colors w-full text-left uppercase"
        >
          <LogOut size={13} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}

function AiSidebarButton() {
  const { setOpen, agentName, agentEnabled } = useAiAssistant();
  if (!agentEnabled) return null;
  return (
    <div className="px-3 pb-3">
      <button
        onClick={() => setOpen(true)}
        className="relative w-full flex items-center gap-3 px-3 py-3 border border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400 hover:bg-emerald-500/15 transition-colors group overflow-hidden"
      >
        <span className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-emerald-400/10 to-transparent" />
        <div className="relative flex h-6 w-6 shrink-0 items-center justify-center border border-emerald-500/40 bg-emerald-500/10">
          <span className="absolute inset-0 animate-ping border border-emerald-400/30" style={{ animationDuration: '2.5s' }} />
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
          </svg>
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-[11px] font-bold tracking-widest uppercase truncate">{agentName}</p>
          <p className="text-[9px] text-emerald-400/50 tracking-wide mt-0.5">msaidizi wa duka lako</p>
        </div>
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
      </button>
    </div>
  );
}

export default function MerchantDashboardLayout({ children }: { children: React.ReactNode }) {
  const [merchant, setMerchant] = useState<MerchantAccount | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setThemeState] = useState<PortalTheme>('dark');
  const [font, setFontState] = useState<PortalFont>('mono');
  const router = useRouter();

  useEffect(() => {
    const saved = localStorage.getItem('biashara-theme') as PortalTheme | null;
    if (saved && (saved in THEME_STYLES)) setThemeState(saved);
    const savedFont = localStorage.getItem('biashara-font') as PortalFont | null;
    if (savedFont && ['mono', 'sans', 'round'].includes(savedFont)) setFontState(savedFont);
  }, []);

  function setTheme(t: PortalTheme) {
    setThemeState(t);
    localStorage.setItem('biashara-theme', t);
  }

  function setFont(f: PortalFont) {
    setFontState(f);
    localStorage.setItem('biashara-font', f);
  }

  const refresh = async () => {
    try {
      const res = await fetch('/merchant/api/auth/me');
      if (!res.ok) { router.replace('/merchant'); return; }
      const data = await res.json();
      setMerchant(data.merchant);
    } catch {
      router.replace('/merchant');
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleLogout = async () => {
    await fetch('/merchant/api/auth/logout', { method: 'POST' });
    router.replace('/merchant');
  };

  const s = THEME_STYLES[theme];
  const fontVar = font === 'sans' ? 'var(--font-poppins)' : font === 'round' ? 'var(--font-montserrat)' : null;

  return (
    <AiAssistantProvider>
    <Ctx.Provider value={{ merchant, refresh, theme, setTheme, font, setFont }}>
      {/* Light theme: sidebar stays dark, only main content area is overridden */}
      {theme === 'light' && (
        <style>{`
          /* ── Backgrounds ── */
          .portal-main { background-color: #f4f4f5 !important; }
          .portal-main .bg-black { background-color: #ffffff !important; }
          .portal-main .bg-white\\/\\[0\\.02\\],
          .portal-main .bg-white\\/\\[0\\.03\\],
          .portal-main .bg-white\\/\\[0\\.04\\],
          .portal-main .bg-white\\/\\[0\\.05\\],
          .portal-main .bg-white\\/\\[0\\.06\\] { background-color: rgba(0,0,0,0.04) !important; }
          .portal-main .bg-white\\/5        { background-color: rgba(0,0,0,0.04) !important; }
          .portal-main .hover\\:bg-white\\/\\[0\\.03\\]:hover,
          .portal-main .hover\\:bg-white\\/\\[0\\.04\\]:hover,
          .portal-main .hover\\:bg-white\\/\\[0\\.05\\]:hover { background-color: rgba(0,0,0,0.06) !important; }
          .portal-main .hover\\:bg-white\\/5:hover,
          .portal-main .hover\\:bg-white\\/\\[0\\.02\\]:hover { background-color: rgba(0,0,0,0.04) !important; }
          .portal-main .hover\\:bg-gray-600:hover  { background-color: #e4e4e7 !important; }
          .portal-main .hover\\:bg-blue-600:hover  { background-color: #2563eb !important; }

          /* ── Borders ── */
          .portal-main .border-white\\/5   { border-color: rgba(0,0,0,0.07) !important; }
          .portal-main .border-white\\/8   { border-color: rgba(0,0,0,0.09) !important; }
          .portal-main .border-white\\/10  { border-color: rgba(0,0,0,0.11) !important; }
          .portal-main .border-white\\/15  { border-color: rgba(0,0,0,0.15) !important; }
          .portal-main .border-white\\/20  { border-color: rgba(0,0,0,0.18) !important; }
          .portal-main .border-white\\/25  { border-color: rgba(0,0,0,0.22) !important; }
          .portal-main .divide-white\\/\\[0\\.04\\] > * + *,
          .portal-main .divide-white\\/\\[0\\.06\\] > * + * { border-color: rgba(0,0,0,0.08) !important; }
          .portal-main .hover\\:border-white\\/20:hover { border-color: rgba(0,0,0,0.22) !important; }
          .portal-main .hover\\:border-white\\/25:hover { border-color: rgba(0,0,0,0.25) !important; }
          .portal-main .border-dashed.border-white\\/15 { border-color: rgba(0,0,0,0.15) !important; }
          .portal-main .hover\\:border-emerald-500\\/30:hover { border-color: rgba(4,120,87,0.35) !important; }

          /* ── Tables ── */
          .portal-main table thead tr { background-color: rgba(0,0,0,0.035) !important; }
          .portal-main table tbody tr:hover { background-color: rgba(0,0,0,0.03) !important; }
          .portal-main table td, .portal-main table th { border-color: rgba(0,0,0,0.08) !important; }

          /* ── Text — 5-level zinc scale (static + hover) ── */
          .portal-main .text-white,
          .portal-main .hover\\:text-white:hover         { color: #09090b !important; }
          .portal-main .text-white\\/90,
          .portal-main .hover\\:text-white\\/90:hover    { color: #18181b !important; }
          .portal-main .text-white\\/80,
          .portal-main .hover\\:text-white\\/80:hover    { color: #18181b !important; }
          .portal-main .text-white\\/70,
          .portal-main .hover\\:text-white\\/70:hover    { color: #27272a !important; }
          .portal-main .text-white\\/60,
          .portal-main .hover\\:text-white\\/60:hover    { color: #3f3f46 !important; }
          .portal-main .text-white\\/50,
          .portal-main .hover\\:text-white\\/50:hover    { color: #52525b !important; }
          .portal-main .text-white\\/40,
          .portal-main .hover\\:text-white\\/40:hover    { color: #71717a !important; }
          .portal-main .text-white\\/35,
          .portal-main .hover\\:text-white\\/35:hover    { color: #71717a !important; }
          .portal-main .text-white\\/30,
          .portal-main .hover\\:text-white\\/30:hover    { color: #a1a1aa !important; }
          .portal-main .text-white\\/25,
          .portal-main .hover\\:text-white\\/25:hover    { color: #a1a1aa !important; }
          .portal-main .text-white\\/20,
          .portal-main .hover\\:text-white\\/20:hover    { color: #d4d4d8 !important; }
          .portal-main .text-zinc-300,
          .portal-main .text-zinc-400              { color: #3f3f46 !important; }
          .portal-main .text-zinc-500,
          .portal-main .text-zinc-600              { color: #71717a !important; }

          /* ── Emerald accent ── */
          .portal-main .text-emerald-400,
          .portal-main .hover\\:text-emerald-400:hover     { color: #047857 !important; }
          .portal-main .text-emerald-400\\/70,
          .portal-main .text-emerald-400\\/80              { color: rgba(4,120,87,0.85) !important; }
          .portal-main .text-emerald-400\\/60              { color: rgba(4,120,87,0.70) !important; }
          .portal-main .hover\\:text-emerald-400\\/80:hover { color: rgba(4,120,87,0.90) !important; }
          .portal-main .hover\\:bg-emerald-500\\/20:hover  { background-color: rgba(4,120,87,0.18) !important; }
          .portal-main .hover\\:bg-emerald-500\\/25:hover  { background-color: rgba(4,120,87,0.22) !important; }
          .portal-main .border-emerald-500\\/25,
          .portal-main .border-emerald-500\\/20,
          .portal-main .border-emerald-500\\/15     { border-color: rgba(4,120,87,0.28) !important; }
          .portal-main .border-emerald-500\\/35,
          .portal-main .border-emerald-500\\/40     { border-color: rgba(4,120,87,0.45) !important; }
          .portal-main .border-emerald-500\\/50     { border-color: rgba(4,120,87,0.55) !important; }
          .portal-main .bg-emerald-500\\/10         { background-color: rgba(4,120,87,0.10) !important; }
          .portal-main .bg-emerald-500\\/20         { background-color: rgba(4,120,87,0.16) !important; }
          .portal-main .bg-emerald-500\\/5,
          .portal-main .bg-emerald-500\\/\\[0\\.03\\],
          .portal-main .bg-emerald-500\\/\\[0\\.04\\],
          .portal-main .bg-emerald-500\\/\\[0\\.05\\],
          .portal-main .bg-emerald-500\\/\\[0\\.06\\],
          .portal-main .bg-emerald-500\\/\\[0\\.07\\],
          .portal-main .bg-emerald-500\\/\\[0\\.08\\] { background-color: rgba(4,120,87,0.07) !important; }
          .portal-main .from-emerald-500\\/\\[0\\.07\\] { --tw-gradient-from: rgba(4,120,87,0.07) !important; }

          /* ── Amber / warning ── */
          .portal-main .text-amber-400             { color: #b45309 !important; }
          .portal-main .text-amber-400\\/70,
          .portal-main .text-amber-400\\/80         { color: rgba(180,83,9,0.85) !important; }
          .portal-main .text-amber-400\\/60         { color: rgba(180,83,9,0.70) !important; }
          .portal-main .border-amber-500\\/25,
          .portal-main .border-amber-500\\/20       { border-color: rgba(180,83,9,0.28) !important; }
          .portal-main .bg-amber-500\\/\\[0\\.03\\],
          .portal-main .bg-amber-500\\/\\[0\\.04\\],
          .portal-main .bg-amber-500\\/\\[0\\.05\\]   { background-color: rgba(180,83,9,0.07) !important; }

          /* ── Rose / error ── */
          .portal-main .text-rose-300,
          .portal-main .text-rose-400              { color: #be123c !important; }
          .portal-main .border-rose-500\\/20        { border-color: rgba(190,18,60,0.25) !important; }
          .portal-main .bg-rose-500\\/5,
          .portal-main .bg-rose-500\\/\\[0\\.03\\]    { background-color: rgba(190,18,60,0.06) !important; }

          /* ── Status dots ── */
          .portal-main .bg-emerald-400             { background-color: #059669 !important; }
          .portal-main .bg-rose-400                { background-color: #e11d48 !important; }
          .portal-main .bg-amber-400               { background-color: #d97706 !important; }
          .portal-main .bg-emerald-500             { background-color: #059669 !important; }

          /* ── Input fields ── */
          .portal-main input[type="text"],
          .portal-main input[type="email"],
          .portal-main input[type="tel"],
          .portal-main input[type="number"],
          .portal-main input[type="url"] {
            background-color: #ffffff !important;
            color: #09090b !important;
            border-color: rgba(0,0,0,0.18) !important;
          }
          .portal-main input::placeholder { color: #a1a1aa !important; }
          .portal-main input:focus { border-color: rgba(4,120,87,0.55) !important; }

          /* ── Store card gradient ── */
          .portal-main .from-emerald-500\\/\\[0\\.07\\] { --tw-gradient-from: rgba(4,120,87,0.05) !important; }
        `}</style>
      )}

      {/* Pink theme: off-white content area + pink accent remap + readable text */}
      {theme === 'pink' && (
        <style>{`
          /* ── Content area background ── */
          .portal-main                              { background-color: #fdf0f6 !important; }
          .portal-main .bg-black                   { background-color: #ffffff !important; }
          .portal-main .bg-white\\/\\[0\\.02\\],
          .portal-main .bg-white\\/\\[0\\.03\\],
          .portal-main .bg-white\\/\\[0\\.04\\],
          .portal-main .bg-white\\/\\[0\\.05\\],
          .portal-main .bg-white\\/\\[0\\.06\\]       { background-color: rgba(0,0,0,0.03) !important; }
          .portal-main .bg-white\\/5               { background-color: rgba(0,0,0,0.03) !important; }
          .portal-main .hover\\:bg-white\\/\\[0\\.03\\]:hover,
          .portal-main .hover\\:bg-white\\/5:hover  { background-color: rgba(0,0,0,0.05) !important; }

          /* ── Borders ── */
          .portal-main .border-white\\/5           { border-color: rgba(0,0,0,0.07) !important; }
          .portal-main .border-white\\/8           { border-color: rgba(0,0,0,0.09) !important; }
          .portal-main .border-white\\/10          { border-color: rgba(0,0,0,0.11) !important; }
          .portal-main .border-white\\/15          { border-color: rgba(0,0,0,0.14) !important; }
          .portal-main .border-white\\/20          { border-color: rgba(0,0,0,0.17) !important; }
          .portal-main .border-white\\/25          { border-color: rgba(0,0,0,0.21) !important; }
          .portal-main .hover\\:border-white\\/20:hover { border-color: rgba(0,0,0,0.22) !important; }
          .portal-main .hover\\:border-white\\/25:hover { border-color: rgba(0,0,0,0.25) !important; }
          .portal-main .divide-white\\/\\[0\\.04\\] > * + *,
          .portal-main .divide-white\\/\\[0\\.06\\] > * + * { border-color: rgba(0,0,0,0.08) !important; }

          /* ── Text — zinc scale (static + hover) ── */
          .portal-main .text-white,
          .portal-main .hover\\:text-white:hover         { color: #1a0010 !important; }
          .portal-main .text-white\\/90,
          .portal-main .hover\\:text-white\\/90:hover    { color: #2d0018 !important; }
          .portal-main .text-white\\/80,
          .portal-main .hover\\:text-white\\/80:hover    { color: #3f0022 !important; }
          .portal-main .text-white\\/70,
          .portal-main .hover\\:text-white\\/70:hover    { color: #52002b !important; }
          .portal-main .text-white\\/60,
          .portal-main .hover\\:text-white\\/60:hover    { color: #6b3050 !important; }
          .portal-main .text-white\\/50,
          .portal-main .hover\\:text-white\\/50:hover    { color: #7c4462 !important; }
          .portal-main .text-white\\/40,
          .portal-main .hover\\:text-white\\/40:hover    { color: #9d6680 !important; }
          .portal-main .text-white\\/35,
          .portal-main .hover\\:text-white\\/35:hover    { color: #a87088 !important; }
          .portal-main .text-white\\/30,
          .portal-main .hover\\:text-white\\/30:hover    { color: #bf90a8 !important; }
          .portal-main .text-white\\/25,
          .portal-main .hover\\:text-white\\/25:hover    { color: #ccaabc !important; }
          .portal-main .text-white\\/20,
          .portal-main .hover\\:text-white\\/20:hover    { color: #d9c0ce !important; }

          /* ── Pink accent remap (was emerald) ── */
          .portal-main .text-emerald-400,
          .portal-main .hover\\:text-emerald-400:hover   { color: #db2777 !important; }
          .portal-main .text-emerald-400\\/70,
          .portal-main .text-emerald-400\\/80            { color: rgba(219,39,119,0.85) !important; }
          .portal-main .text-emerald-400\\/60            { color: rgba(219,39,119,0.70) !important; }
          .portal-main .border-emerald-500\\/25,
          .portal-main .border-emerald-500\\/20,
          .portal-main .border-emerald-500\\/15          { border-color: rgba(236,72,153,0.28) !important; }
          .portal-main .border-emerald-500\\/35,
          .portal-main .border-emerald-500\\/40          { border-color: rgba(236,72,153,0.45) !important; }
          .portal-main .border-emerald-500\\/50          { border-color: rgba(236,72,153,0.55) !important; }
          .portal-main .bg-emerald-500\\/10              { background-color: rgba(236,72,153,0.10) !important; }
          .portal-main .bg-emerald-500\\/20              { background-color: rgba(236,72,153,0.16) !important; }
          .portal-main .hover\\:bg-emerald-500\\/20:hover { background-color: rgba(236,72,153,0.18) !important; }
          .portal-main .bg-emerald-500\\/5,
          .portal-main .bg-emerald-500\\/\\[0\\.03\\],
          .portal-main .bg-emerald-500\\/\\[0\\.04\\],
          .portal-main .bg-emerald-500\\/\\[0\\.05\\],
          .portal-main .bg-emerald-500\\/\\[0\\.06\\],
          .portal-main .bg-emerald-500\\/\\[0\\.07\\],
          .portal-main .bg-emerald-500\\/\\[0\\.08\\]      { background-color: rgba(236,72,153,0.07) !important; }
          .portal-main .bg-emerald-400,
          .portal-main .bg-emerald-500                  { background-color: #ec4899 !important; }
          .portal-main .border-emerald-950              { border-color: rgba(236,72,153,0.15) !important; }
          .portal-main .border-emerald-800\\/50          { border-color: rgba(236,72,153,0.30) !important; }
          .portal-main .from-emerald-500\\/\\[0\\.07\\]   { --tw-gradient-from: rgba(236,72,153,0.07) !important; }

          /* ── Inputs ── */
          .portal-main input[type="text"],
          .portal-main input[type="email"],
          .portal-main input[type="number"],
          .portal-main input[type="url"] {
            background-color: #ffffff !important;
            color: #1a0010 !important;
            border-color: rgba(236,72,153,0.25) !important;
          }
          .portal-main input::placeholder          { color: #bf90a8 !important; }
          .portal-main input:focus                 { border-color: rgba(236,72,153,0.55) !important; }

          /* ── Status dots ── */
          .portal-main .bg-emerald-400             { background-color: #ec4899 !important; }
          .portal-main .text-amber-400             { color: #b45309 !important; }
          .portal-main .text-rose-400              { color: #be123c !important; }
        `}</style>
      )}

      {fontVar && (
        <style>{`.portal-root, .portal-root * { font-family: ${fontVar} !important; }`}</style>
      )}

      <div className={`portal-root flex h-screen ${s.root} text-white overflow-hidden font-mono`}>
        {/* Desktop sidebar */}
        <div className="hidden lg:flex flex-col h-full">
          <Sidebar merchant={merchant} onLogout={handleLogout} theme={theme} setTheme={setTheme} font={font} setFont={setFont} />
        </div>

        {/* Mobile sidebar */}
        {sidebarOpen && (
          <>
            <div className="fixed inset-0 bg-black/70 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
            <div className="fixed left-0 top-0 h-full z-40 lg:hidden">
              <Sidebar merchant={merchant} onLogout={handleLogout} onClose={() => setSidebarOpen(false)} theme={theme} setTheme={setTheme} font={font} setFont={setFont} />
            </div>
          </>
        )}

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile top bar */}
          <div className={`lg:hidden flex items-center justify-between px-5 py-3 border-b ${s.border} ${s.mobilebar}`}>
            <button onClick={() => setSidebarOpen(true)} className="text-white/40 hover:text-white transition-colors">
              <Menu size={18} />
            </button>
            <span className="text-xs font-bold tracking-widest uppercase text-white">
              n<span className="text-emerald-400">TZS</span> Biashara
            </span>
            <div className="w-5" />
          </div>

          <main className="portal-main flex-1 overflow-y-auto">
            {children}
          </main>
          <AiAssistant />
        </div>
      </div>
    </Ctx.Provider>
    </AiAssistantProvider>
  );
}
