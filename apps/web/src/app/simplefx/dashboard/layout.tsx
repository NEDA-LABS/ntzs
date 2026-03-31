'use client';

import { useState, useEffect, createContext, useContext } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, ArrowDownToLine, ArrowUpRight, SlidersHorizontal,
  Activity, Settings, LogOut, Menu, ArrowLeftRight,
} from 'lucide-react';

export interface LpAccount {
  id: string;
  email: string;
  displayName: string | null;
  walletAddress: string;
  bidBps: number;
  askBps: number;
  isActive: boolean;
  onboardingStep: number;
  kycStatus: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface LpCtx {
  lp: LpAccount | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<LpCtx>({ lp: null, refresh: async () => {} });
export const useLp = () => useContext(Ctx);

const NAV = [
  { href: '/simplefx/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/simplefx/dashboard/deposit', label: 'Deposit', icon: ArrowDownToLine },
  { href: '/simplefx/dashboard/withdraw', label: 'Withdraw', icon: ArrowUpRight },
  { href: '/simplefx/dashboard/spread', label: 'Spread', icon: SlidersHorizontal },
  { href: '/simplefx/dashboard/swap', label: 'Swap', icon: ArrowLeftRight },
  { href: '/simplefx/dashboard/positions', label: 'Positions', icon: Activity },
  { href: '/simplefx/dashboard/settings', label: 'Settings', icon: Settings },
];

function Sidebar({ lp, onLogout }: { lp: LpAccount | null; onLogout: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col h-full w-60 bg-black border-r border-white/5 px-4 py-6">
      <div className="mb-8 px-2">
        <Link href="/simplefx" className="text-white font-semibold tracking-tight text-sm">
          Simple<span className="text-blue-400">FX</span>
        </Link>
        {lp && (
          <p className="text-zinc-600 text-xs mt-1 truncate">{lp.email}</p>
        )}
      </div>

      <nav className="flex-1 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-blue-600/15 text-blue-400'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={onLogout}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-600 hover:text-zinc-300 hover:bg-white/5 transition-colors w-full text-left mt-4"
      >
        <LogOut size={16} />
        Sign out
      </button>
    </aside>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [lp, setLp] = useState<LpAccount | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();

  const refresh = async () => {
    try {
      const res = await fetch('/simplefx/api/auth/me');
      if (!res.ok) { router.replace('/simplefx'); return; }
      const data = await res.json();
      setLp(data.lp);
    } catch {
      router.replace('/simplefx');
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleLogout = async () => {
    await fetch('/simplefx/api/auth/logout', { method: 'POST' });
    router.replace('/simplefx');
  };

  return (
    <Ctx.Provider value={{ lp, refresh }}>
      <div className="flex h-screen bg-black text-white overflow-hidden">
        {/* Desktop sidebar */}
        <div className="hidden lg:flex flex-col h-full">
          <Sidebar lp={lp} onLogout={handleLogout} />
        </div>

        {/* Mobile sidebar overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/70 z-30 lg:hidden"
                onClick={() => setSidebarOpen(false)}
              />
              <motion.div
                initial={{ x: -240 }}
                animate={{ x: 0 }}
                exit={{ x: -240 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
                className="fixed left-0 top-0 h-full z-40 lg:hidden"
              >
                <Sidebar lp={lp} onLogout={handleLogout} />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile topbar */}
          <div className="lg:hidden flex items-center gap-4 px-4 py-3 border-b border-white/5">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              <Menu size={20} />
            </button>
            <span className="text-sm font-medium text-white">
              Simple<span className="text-blue-400">FX</span>
            </span>
          </div>

          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
