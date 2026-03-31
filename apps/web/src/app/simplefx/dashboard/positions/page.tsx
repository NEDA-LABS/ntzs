'use client';

import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { useLp } from '../layout';

export default function PositionsPage() {
  const { lp } = useLp();
  if (!lp) return null;

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-1">Positions</p>
        <h1 className="text-3xl font-thin text-white mb-8">Order fills</h1>

        <div className="rounded-2xl border border-white/5 bg-zinc-950 p-16 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-xl bg-zinc-900 flex items-center justify-center mb-4">
            <Activity size={20} className="text-zinc-600" />
          </div>
          <p className="text-zinc-400 text-sm font-medium mb-1">No fills yet</p>
          <p className="text-zinc-600 text-xs max-w-xs leading-relaxed">
            Once your position is live and inventory is funded, filled orders will appear here in real time.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
