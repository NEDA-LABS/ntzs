'use client'

import { useEffect, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle, XCircle, ArrowLeftRight, X } from 'lucide-react'

type Kind = 'deposit_complete' | 'deposit_failed' | 'swap_complete' | 'deposit_submitted'

interface Toast {
  id: string
  kind: Kind
  title: string
  body: string
}

function toastId() {
  return Math.random().toString(36).slice(2)
}

const MAX_TOASTS = 3
const AUTO_DISMISS_MS = 6_000

const META: Record<Kind, { icon: React.ReactNode; border: string; bg: string }> = {
  deposit_complete: {
    icon: <CheckCircle className="h-4 w-4 text-emerald-400" />,
    border: 'border-emerald-500/25',
    bg:     'bg-emerald-500/[0.06]',
  },
  deposit_failed: {
    icon: <XCircle className="h-4 w-4 text-rose-400" />,
    border: 'border-rose-500/25',
    bg:     'bg-rose-500/[0.06]',
  },
  deposit_submitted: {
    icon: <CheckCircle className="h-4 w-4 text-amber-400" />,
    border: 'border-amber-500/25',
    bg:     'bg-amber-500/[0.06]',
  },
  swap_complete: {
    icon: <ArrowLeftRight className="h-4 w-4 text-violet-400" />,
    border: 'border-violet-500/25',
    bg:     'bg-violet-500/[0.06]',
  },
}

export function NotificationCenter() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = toastId()
    setToasts(prev => [...prev.slice(-(MAX_TOASTS - 1)), { ...t, id }])
    setTimeout(() => remove(id), AUTO_DISMISS_MS)
  }, [])

  function remove(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  useEffect(() => {
    // ── deposit:complete ─────────────────────────────────────────
    const onComplete = (e: Event) => {
      const { amountTzs } = (e as CustomEvent).detail ?? {}
      push({
        kind:  'deposit_complete',
        title: 'Deposit confirmed',
        body:  amountTzs
          ? `${(amountTzs as number).toLocaleString()} TZS has been minted to your wallet.`
          : 'Your deposit has been minted to your wallet.',
      })
    }

    // ── deposit:failed ────────────────────────────────────────────
    const onFailed = (e: Event) => {
      const { amountTzs } = (e as CustomEvent).detail ?? {}
      push({
        kind:  'deposit_failed',
        title: 'Deposit failed',
        body:  amountTzs
          ? `Your deposit of ${(amountTzs as number).toLocaleString()} TZS could not be processed.`
          : 'Your deposit could not be processed. Please try again.',
      })
    }

    // ── swap:complete ─────────────────────────────────────────────
    const onSwap = () => {
      push({
        kind:  'swap_complete',
        title: 'Swap complete',
        body:  'Your swap has been filled and settled on Base.',
      })
    }

    window.addEventListener('deposit:complete', onComplete)
    window.addEventListener('deposit:failed',   onFailed)
    window.addEventListener('swap:complete',    onSwap)

    // ── legacy sessionStorage handoff (DepositForm sets this) ────
    try {
      const raw = sessionStorage.getItem('deposit_success')
      if (raw) {
        sessionStorage.removeItem('deposit_success')
        const data = JSON.parse(raw) as { amount?: number; method?: string }
        if (data?.amount && data.amount > 0) {
          push({
            kind:  'deposit_submitted',
            title: 'Deposit submitted',
            body:  data.method === 'card'
              ? `${data.amount.toLocaleString()} TZS — complete your card checkout to finish.`
              : `${data.amount.toLocaleString()} TZS — check your phone to approve the M-Pesa prompt.`,
          })
        }
      }
    } catch {}

    return () => {
      window.removeEventListener('deposit:complete', onComplete)
      window.removeEventListener('deposit:failed',   onFailed)
      window.removeEventListener('swap:complete',    onSwap)
    }
  }, [push])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      <AnimatePresence>
        {toasts.map(t => {
          const meta = META[t.kind]
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit={{    opacity: 0, y: -8,  scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border ${meta.border} ${meta.bg} p-4 shadow-2xl ring-1 ring-white/[0.04] backdrop-blur-xl`}
            >
              <div className="mt-0.5 shrink-0">{meta.icon}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{t.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-white/60">{t.body}</p>
              </div>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="shrink-0 rounded-lg p-1 text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
