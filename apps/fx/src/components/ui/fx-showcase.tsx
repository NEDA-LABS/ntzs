'use client';

import { useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { TrendingUp, BarChart3, Layers, ArrowRight, ChevronRight, type LucideIcon } from 'lucide-react';

// =========================================
// TYPES
// =========================================

export type TokenSide = 'ntzs' | 'usdc';

interface Metric {
  label: string;
  value: number;
  display: string;
  icon: LucideIcon;
}

interface ShowcaseItem {
  id: TokenSide;
  label: string;
  title: string;
  description: string;
  colors: {
    gradient: string;
    glowColor: string;
    ring: string;
    bar: string;
    accent: string;
    bgRadial: string;
  };
  status: string;
  metrics: Metric[];
  earning: string;
}

// =========================================
// DATA
// =========================================

const SHOWCASE: Record<TokenSide, ShowcaseItem> = {
  ntzs: {
    id: 'ntzs',
    label: 'nTZS',
    title: 'The Ask Side',
    description:
      'Deposit nTZS as your ask inventory. Every time a trader swaps USDC for nTZS, your ask order fills and you pocket the spread — no manual trading required.',
    colors: {
      gradient: 'from-emerald-600 to-teal-900',
      glowColor: 'rgba(52, 211, 153, 0.35)',
      ring: 'border-emerald-500/30',
      bar: 'bg-emerald-500',
      accent: 'text-emerald-400',
      bgRadial: 'rgba(52, 211, 153, 0.10)',
    },
    status: 'Ask Side Active',
    metrics: [
      { label: 'Ask Spread', value: 75, display: '1.5%', icon: TrendingUp },
      { label: 'Fill Rate', value: 94, display: '94%', icon: BarChart3 },
    ],
    earning: 'Earn on every nTZS sold to traders',
  },
  usdc: {
    id: 'usdc',
    label: 'USDC',
    title: 'The Bid Side',
    description:
      'Hold USDC as your bid reserve. When traders exit nTZS positions, your USDC absorbs the sell flow and you earn the bid spread on every fill, around the clock.',
    colors: {
      gradient: 'from-blue-600 to-indigo-900',
      glowColor: 'rgba(59, 130, 246, 0.35)',
      ring: 'border-blue-500/30',
      bar: 'bg-blue-500',
      accent: 'text-blue-400',
      bgRadial: 'rgba(59, 130, 246, 0.10)',
    },
    status: 'Bid Side Active',
    metrics: [
      { label: 'Bid Spread', value: 60, display: '1.2%', icon: TrendingUp },
      { label: 'Pool Depth', value: 87, display: '87%', icon: Layers },
    ],
    earning: 'Earn on every nTZS bought from traders',
  },
};

// =========================================
// ANIMATIONS
// =========================================

const contentVariants: Variants = {
  hidden: { opacity: 0, y: 16, filter: 'blur(8px)' },
  visible: {
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { type: 'spring', stiffness: 100, damping: 20 },
  },
  exit: { opacity: 0, y: -10, filter: 'blur(6px)', transition: { duration: 0.2 } },
};

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const logoVariants = (isLeft: boolean): Variants => ({
  initial: {
    opacity: 0,
    scale: 1.4,
    filter: 'blur(12px)',
    rotate: isLeft ? -20 : 20,
    x: isLeft ? -60 : 60,
  },
  animate: {
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    rotate: 0,
    x: 0,
    transition: { type: 'spring', stiffness: 240, damping: 22 },
  },
  exit: {
    opacity: 0,
    scale: 0.7,
    filter: 'blur(16px)',
    transition: { duration: 0.2 },
  },
});

// =========================================
// TOKEN VISUALS
// =========================================

const NTZSLogo = () => (
  <div className="relative w-full h-full flex items-center justify-center p-8">
    <img
      src="/ntzs-icon.svg"
      alt="nTZS"
      className="w-48 h-48 object-contain drop-shadow-[0_0_40px_rgba(52,211,153,0.5)]"
      draggable={false}
    />
  </div>
);

const USDCLogo = () => (
  <div className="relative w-full h-full flex items-center justify-center p-8">
    <div className="relative">
      <div
        className="w-44 h-44 rounded-full bg-gradient-to-br from-blue-400 to-blue-700 flex flex-col items-center justify-center"
        style={{ boxShadow: '0 0 50px rgba(59,130,246,0.45)' }}
      >
        <span className="text-white font-bold text-4xl tracking-tight leading-none">$</span>
        <span className="text-white/80 font-semibold text-sm tracking-widest uppercase mt-1">USDC</span>
      </div>
    </div>
  </div>
);

// =========================================
// TOKEN VISUAL CONTAINER
// =========================================

const TokenVisual = ({ data, isLeft }: { data: ShowcaseItem; isLeft: boolean }) => (
  <div className="relative shrink-0 flex items-center justify-center">
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
      className={`absolute inset-[-18%] rounded-full border border-dashed ${data.colors.ring}`}
    />
    <motion.div
      animate={{ rotate: -180 }}
      transition={{ duration: 36, repeat: Infinity, ease: 'linear' }}
      className={`absolute inset-[-8%] rounded-full border border-dotted ${data.colors.ring} opacity-40`}
    />
    <motion.div
      animate={{ scale: [1, 1.06, 1] }}
      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      className={`absolute inset-0 rounded-full bg-gradient-to-br ${data.colors.gradient} blur-2xl opacity-30`}
    />

    <div className="relative h-56 w-56 md:h-72 md:w-72 rounded-full border border-white/5 shadow-2xl flex items-center justify-center overflow-hidden bg-black/20 backdrop-blur-sm">
      <motion.div
        animate={{ y: [-8, 8, -8] }}
        transition={{ repeat: Infinity, duration: 5, ease: 'easeInOut' }}
        className="w-full h-full"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={data.id}
            variants={logoVariants(isLeft)}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full h-full"
          >
            {data.id === 'ntzs' ? <NTZSLogo /> : <USDCLogo />}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>

    <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-zinc-500 bg-zinc-950/80 px-3 py-1.5 rounded-full border border-white/5 backdrop-blur">
        <span
          className="h-1.5 w-1.5 rounded-full animate-pulse"
          style={{ backgroundColor: data.id === 'ntzs' ? 'rgb(52,211,153)' : 'rgb(59,130,246)' }}
        />
        {data.status}
      </div>
    </div>
  </div>
);

// =========================================
// DETAIL PANEL
// =========================================

const TokenDetails = ({ data }: { data: ShowcaseItem }) => (
  <motion.div
    variants={containerVariants}
    initial="hidden"
    animate="visible"
    exit="exit"
    className="flex flex-col items-start text-left"
  >
    <motion.span variants={contentVariants} className={`text-xs font-bold uppercase tracking-[0.2em] mb-2 ${data.colors.accent}`}>
      {data.id === 'ntzs' ? 'Provide nTZS' : 'Provide USDC'}
    </motion.span>

    <motion.h3
      variants={contentVariants}
      className="text-3xl md:text-4xl font-bold tracking-tight mb-3 text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-500"
    >
      {data.title}
    </motion.h3>

    <motion.p variants={contentVariants} className="text-zinc-400 text-sm leading-relaxed mb-6 max-w-sm">
      {data.description}
    </motion.p>

    {/* Metrics */}
    <motion.div
      variants={contentVariants}
      className="w-full space-y-5 bg-zinc-900/40 p-5 rounded-2xl border border-white/5 backdrop-blur-sm"
    >
      {data.metrics.map((metric, idx) => (
        <div key={metric.label}>
          <div className="flex items-center justify-between mb-2 text-sm">
            <div className="flex items-center gap-2 text-zinc-300">
              {(() => { const Icon = metric.icon; return <Icon size={14} />; })()}
              <span>{metric.label}</span>
            </div>
            <span className={`font-mono text-sm font-semibold ${data.colors.accent}`}>{metric.display}</span>
          </div>
          <div className="relative h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${metric.value}%` }}
              transition={{ duration: 1, delay: 0.3 + idx * 0.15, ease: 'easeOut' }}
              className={`absolute top-0 bottom-0 ${data.colors.bar} opacity-80 rounded-full`}
            />
          </div>
        </div>
      ))}

      <div className="pt-3 border-t border-white/5">
        <p className="text-xs text-zinc-500">{data.earning}</p>
      </div>

      <button
        type="button"
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-white transition-colors group"
      >
        <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
        View full spec
      </button>
    </motion.div>
  </motion.div>
);

// =========================================
// SWAP FLOW INDICATOR
// =========================================

const SwapFlow = ({ active }: { active: TokenSide }) => (
  <div className="flex items-center justify-center gap-3 text-xs text-zinc-600 select-none">
    <span className={active === 'ntzs' ? 'text-white font-medium' : 'text-zinc-600'}>USDC</span>
    <ArrowRight size={12} className="text-zinc-700" />
    <div className="px-2 py-0.5 rounded border border-white/5 bg-zinc-900/60 text-zinc-500">
      {active === 'ntzs' ? '+1.5% spread' : '+1.2% spread'}
    </div>
    <ArrowRight size={12} className="text-zinc-700" />
    <span className={active === 'usdc' ? 'text-white font-medium' : 'text-zinc-600'}>nTZS</span>
  </div>
);

// =========================================
// INLINE SWITCHER
// =========================================

const Switcher = ({ active, onToggle }: { active: TokenSide; onToggle: (id: TokenSide) => void }) => (
  <div className="flex items-center gap-1 p-1 rounded-full bg-zinc-900/80 backdrop-blur border border-white/10">
    {(['ntzs', 'usdc'] as TokenSide[]).map((id) => (
      <motion.button
        key={id}
        onClick={() => onToggle(id)}
        whileTap={{ scale: 0.96 }}
        className="relative px-6 py-2.5 rounded-full text-sm font-medium focus:outline-none"
      >
        {active === id && (
          <motion.div
            layoutId="fx-switcher-pill"
            className="absolute inset-0 rounded-full bg-gradient-to-b from-white/10 to-white/5"
            transition={{ type: 'spring', stiffness: 220, damping: 22 }}
          />
        )}
        <span
          className={`relative z-10 transition-colors duration-200 ${
            active === id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {id === 'ntzs' ? 'nTZS' : 'USDC'}
        </span>
      </motion.button>
    ))}
  </div>
);

// =========================================
// MAIN SECTION
// =========================================

export default function FXShowcase() {
  const [active, setActive] = useState<TokenSide>('ntzs');
  const data = SHOWCASE[active];
  const isLeft = active === 'ntzs';

  return (
    <section className="relative w-full bg-black overflow-hidden py-24 px-6">
      {/* Background glow that shifts between sides */}
      <motion.div
        animate={{
          background: isLeft
            ? `radial-gradient(circle at 30% 50%, ${SHOWCASE.ntzs.colors.bgRadial}, transparent 60%)`
            : `radial-gradient(circle at 70% 50%, ${SHOWCASE.usdc.colors.bgRadial}, transparent 60%)`,
        }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-0 pointer-events-none"
      />

      <div className="relative z-10 max-w-6xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-16">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-600 mb-3">How It Works</p>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            The Spread is the Yield
          </h2>
          <p className="text-zinc-400 text-base max-w-xl mx-auto leading-relaxed">
            Market makers on SimpleFX earn on both sides of every nTZS swap. Provide inventory, set your spread, and let orders fill automatically.
          </p>
        </div>

        {/* Swap flow indicator */}
        <div className="flex justify-center mb-12">
          <SwapFlow active={active} />
        </div>

        {/* Main showcase — two column layout */}
        <motion.div
          layout
          transition={{ type: 'spring', bounce: 0, duration: 0.8 }}
          className={`flex flex-col md:flex-row items-center justify-center gap-16 md:gap-24 lg:gap-36 w-full ${
            isLeft ? 'md:flex-row' : 'md:flex-row-reverse'
          }`}
        >
          {/* Token visual */}
          <TokenVisual data={data} isLeft={isLeft} />

          {/* Detail panel */}
          <div className="w-full max-w-md">
            <AnimatePresence mode="wait">
              <TokenDetails key={active} data={data} />
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Switcher — centered below content */}
        <div className="flex flex-col items-center gap-4 mt-20">
          <Switcher active={active} onToggle={setActive} />
          <p className="text-xs text-zinc-600">Toggle between liquidity sides</p>
        </div>
      </div>
    </section>
  );
}
