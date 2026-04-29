'use client';

import { useState, useEffect, createContext, useContext } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Link2, Clock, Settings, LogOut, Menu, X } from 'lucide-react';

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
}

interface MerchantCtx {
  merchant: MerchantAccount | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<MerchantCtx>({ merchant: null, refresh: async () => {} });
export const useMerchant = () => useContext(Ctx);

const NAV = [
  { href: '/merchant/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/merchant/dashboard/links', label: 'Payment Links', icon: Link2 },
  { href: '/merchant/dashboard/collections', label: 'Collections', icon: Clock },
  { href: '/merchant/dashboard/settings', label: 'Settings', icon: Settings },
];

function Sidebar({ merchant, onLogout, onClose }: { merchant: MerchantAccount | null; onLogout: () => void; onClose?: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col h-full w-60 bg-black border-r border-white/10 font-mono">
      {/* Header */}
      <div className="px-5 py-5 border-b border-white/10">
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
            <div className="h-px bg-white/10 my-3" />
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
                  ? 'border-l border-emerald-400 pl-[11px] text-emerald-400 bg-emerald-500/5'
                  : 'text-white/35 hover:text-white/70 hover:bg-white/[0.03]'
              }`}
            >
              <Icon size={13} />
              <span className="uppercase tracking-wider">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4 border-t border-white/10 pt-3">
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

export default function MerchantDashboardLayout({ children }: { children: React.ReactNode }) {
  const [merchant, setMerchant] = useState<MerchantAccount | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();

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

  return (
    <Ctx.Provider value={{ merchant, refresh }}>
      <div className="flex h-screen bg-black text-white overflow-hidden font-mono">
        <div className="hidden lg:flex flex-col h-full">
          <Sidebar merchant={merchant} onLogout={handleLogout} />
        </div>

        {sidebarOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/80 z-30 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="fixed left-0 top-0 h-full z-40 lg:hidden">
              <Sidebar merchant={merchant} onLogout={handleLogout} onClose={() => setSidebarOpen(false)} />
            </div>
          </>
        )}

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile top bar */}
          <div className="lg:hidden flex items-center justify-between px-5 py-3 border-b border-white/10">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-white/40 hover:text-white transition-colors"
            >
              <Menu size={18} />
            </button>
            <span className="text-xs font-bold tracking-widest uppercase text-white">
              n<span className="text-emerald-400">TZS</span> Biashara
            </span>
            <div className="w-5" />
          </div>

          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
