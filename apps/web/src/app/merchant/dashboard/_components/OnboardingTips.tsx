'use client';

import * as Popover from '@radix-ui/react-popover';
import { useState, useEffect } from 'react';
import { HelpCircle, X, Plus, Share2, Clock } from 'lucide-react';

const TIPS = [
  {
    icon: Plus,
    title: 'Add your first product',
    description:
      'Click "+ Add Product" to create a payment link. Give it a name, set a price, and upload an image. Takes under a minute.',
  },
  {
    icon: Share2,
    title: 'Share your store link',
    description:
      'Copy your store link from the card above and send it via WhatsApp, SMS, or social media. Customers pay directly from the link — no app needed.',
  },
  {
    icon: Clock,
    title: 'Track incoming payments',
    description:
      'Every confirmed payment appears in Recent Orders in real-time. Head to the Orders tab for the full history and status of each transaction.',
  },
];

const STORAGE_KEY = 'biashara-tips-seen';

export function OnboardingTips({ autoOpen = false }: { autoOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (autoOpen && !sessionStorage.getItem(STORAGE_KEY)) {
      // Small delay so the page renders first
      const t = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(t);
    }
  }, [autoOpen]);

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (!v) sessionStorage.setItem(STORAGE_KEY, '1');
  }

  function next() {
    if (step < TIPS.length - 1) {
      setStep(step + 1);
    } else {
      handleOpenChange(false);
    }
  }

  const tip = TIPS[step];
  const Icon = tip.icon;

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          title="How to get started"
          className="flex items-center gap-1.5 border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[10px] tracking-widest text-white/40 uppercase hover:border-white/25 hover:text-white/60 transition-colors"
        >
          <HelpCircle size={11} />
          Guide
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          className="z-50 w-72 border border-white/10 bg-zinc-900 p-5 shadow-xl shadow-black/40 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          {/* Close */}
          <Popover.Close className="absolute top-3 right-3 text-white/25 hover:text-white/60 transition-colors">
            <X size={13} />
          </Popover.Close>

          {/* Step content */}
          <div className="flex items-start gap-3 mb-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-emerald-500/30 bg-emerald-500/10">
              <Icon size={14} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-white tracking-wide mb-1">{tip.title}</p>
              <p className="text-[11px] text-white/50 leading-relaxed">{tip.description}</p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-white/[0.07] pt-3">
            <div className="flex gap-1">
              {TIPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  className={`h-1 rounded-full transition-all ${
                    i === step ? 'w-4 bg-emerald-400' : 'w-1 bg-white/20 hover:bg-white/40'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={next}
              className="text-[10px] font-semibold tracking-widest text-emerald-400 uppercase hover:text-emerald-300 transition-colors"
            >
              {step === TIPS.length - 1 ? 'Done' : 'Next →'}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
