'use client';

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

interface OrbitBadge {
  label: string;
  icon: string;
  radius: number;
  duration: number;
  initialAngle: number;
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
  orbits: OrbitBadge[];
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
    orbits: [
      { label: 'Base',     icon: '/base.svg',      radius: 152, duration: 18, initialAngle: 0   },
      { label: 'Polygon',  icon: '/polygon.svg',   radius: 152, duration: 18, initialAngle: 180 },
      { label: 'ETH',      icon: '/eth-logo.svg',  radius: 200, duration: 28, initialAngle: 60  },
      { label: 'Arbitrum', icon: '/arbitrum.svg',  radius: 200, duration: 28, initialAngle: 240 },
    ],
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
    orbits: [
      { label: 'USDT', icon: '/usdt-coin.svg',  radius: 152, duration: 20, initialAngle: 40  },
      { label: 'USDC', icon: '/usdc-logo.svg',  radius: 152, duration: 20, initialAngle: 220 },
      { label: 'EURC', icon: '/eurc-coin.png',  radius: 200, duration: 32, initialAngle: 120 },
      { label: 'cNGN', icon: '/cngn.png',       radius: 200, duration: 32, initialAngle: 300 },
    ],
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
  <div className="relative w-full h-full flex items-center justify-center">
    {/* USDT — behind, offset left */}
    <div className="absolute" style={{ left: '50%', top: '50%', transform: 'translate(-72%, -50%)' }}>
      <div className="w-28 h-28 rounded-full bg-zinc-900/80 border border-white/10 flex items-center justify-center shadow-xl">
        <img
          src="/usdt-coin.svg"
          alt="USDT"
          className="w-20 h-20 object-contain drop-shadow-[0_0_20px_rgba(38,195,135,0.5)]"
          draggable={false}
        />
      </div>
    </div>
    {/* USDC — front, offset right */}
    <div className="absolute" style={{ left: '50%', top: '50%', transform: 'translate(-28%, -50%)' }}>
      <div className="w-32 h-32 rounded-full bg-zinc-900/80 border border-white/10 flex items-center justify-center shadow-xl">
        <img
          src="/usdc-logo.svg"
          alt="USDC"
          className="w-24 h-24 object-contain drop-shadow-[0_0_24px_rgba(59,130,246,0.55)]"
          draggable={false}
        />
      </div>
    </div>
  </div>
);

// =========================================
// ORBIT BADGE
// =========================================

const OrbitItem = ({ label, icon, radius, duration, initialAngle }: OrbitBadge) => (
  <motion.div
    animate={{ rotate: [initialAngle, initialAngle + 360] }}
    transition={{ duration, repeat: Infinity, ease: 'linear' }}
    style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: 0,
      height: 0,
      transformOrigin: '0px 0px',
    }}
  >
    <motion.div
      animate={{ rotate: [-(initialAngle), -(initialAngle + 360)] }}
      transition={{ duration, repeat: Infinity, ease: 'linear' }}
      style={{
        position: 'absolute',
        top: -radius,
        transform: 'translateX(-50%)',
      }}
    >
      <div className="flex flex-col items-center gap-1 select-none">
        <div className="w-8 h-8 rounded-full bg-zinc-900/90 border border-white/10 flex items-center justify-center overflow-hidden backdrop-blur-sm shadow-lg">
          <img src={icon} alt={label} className="w-5 h-5 object-contain" draggable={false} />
        </div>
        <span className="text-[9px] font-medium text-zinc-500 leading-none">{label}</span>
      </div>
    </motion.div>
  </motion.div>
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

    {/* Orbiting stablecoins / chains */}
    {data.orbits.map((orbit) => (
      <OrbitItem key={orbit.label} {...orbit} />
    ))}

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
  return (
    <section className="relative w-full bg-black overflow-hidden py-24 px-6">
      {/* Dual background glows — emerald left, blue right */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 20% 50%, ${SHOWCASE.ntzs.colors.bgRadial}, transparent 45%),
                       radial-gradient(circle at 80% 50%, ${SHOWCASE.usdc.colors.bgRadial}, transparent 45%)`,
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto">
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

        {/* Two columns — side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] items-start gap-8 lg:gap-6">

          {/* Left — nTZS ask side */}
          <motion.div
            initial={{ opacity: 0, x: -48 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center gap-12"
          >
            <TokenVisual data={SHOWCASE.ntzs} isLeft={true} />
            <TokenDetails data={SHOWCASE.ntzs} />
          </motion.div>

          {/* Center divider + swap connector */}
          <div className="hidden lg:flex flex-col items-center justify-center self-stretch gap-4 px-2 pt-24">
            <div className="flex-1 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />
            <div className="flex flex-col items-center gap-2 py-4">
              <div className="text-[10px] uppercase tracking-widest text-zinc-600">Ask</div>
              <div className="px-3 py-1.5 rounded-full border border-white/8 bg-zinc-900/60 text-zinc-400 text-xs font-mono">
                1.5%
              </div>
              <ArrowRight size={14} className="text-zinc-700 rotate-90" />
              <ArrowRight size={14} className="text-zinc-700 -rotate-90 -mt-2" />
              <div className="px-3 py-1.5 rounded-full border border-white/8 bg-zinc-900/60 text-zinc-400 text-xs font-mono">
                1.2%
              </div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-600">Bid</div>
            </div>
            <div className="flex-1 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />
          </div>

          {/* Right — USDC bid side */}
          <motion.div
            initial={{ opacity: 0, x: 48 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            className="flex flex-col items-center gap-12"
          >
            <TokenVisual data={SHOWCASE.usdc} isLeft={false} />
            <TokenDetails data={SHOWCASE.usdc} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
