'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface DepositRow { id: string; status: string; amountTzs: number }
interface Props { hasPending: boolean; intervalMs?: number }

const TERMINAL = new Set(['minted', 'rejected', 'cancelled'])

function emit(name: string, detail?: unknown) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(name, { detail }))
  }
}

/**
 * Smart deposit poller.
 *
 * • Polls /api/v1/me/deposits/pending (DB-direct, bypasses MemCache) every intervalMs.
 * • Diffs previous vs current statuses.
 * • Emits  deposit:complete  when a deposit reaches 'minted'   → { id, amountTzs }
 * • Emits  deposit:failed    when a deposit reaches 'rejected' → { id, amountTzs }
 * • Calls  router.refresh()  so server components re-render.
 * • Applies mild backoff after 10 consecutive polls with no change.
 */
export function PendingDepositPoller({ hasPending, intervalMs = 3_000 }: Props) {
  const router = useRouter()
  const prevStatuses = useRef<Record<string, string>>({})
  const pollCount    = useRef(0)
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!hasPending) return

    let cancelled = false

    async function poll() {
      if (cancelled) return

      try {
        const res = await fetch('/api/v1/me/deposits/pending', { cache: 'no-store' })
        if (!res.ok) return

        const { deposits }: { deposits: DepositRow[] } = await res.json()
        const prev = prevStatuses.current
        let changed = false

        for (const d of deposits) {
          const was = prev[d.id]
          const is  = d.status

          if (was && was !== is) {
            changed = true

            if (is === 'minted') {
              emit('deposit:complete', { id: d.id, amountTzs: d.amountTzs })
            } else if (is === 'rejected' || is === 'cancelled') {
              emit('deposit:failed', { id: d.id, amountTzs: d.amountTzs })
            }
          }

          prev[d.id] = is
        }

        if (changed) {
          router.refresh()
          pollCount.current = 0
        } else {
          pollCount.current++
        }
      } catch {
        // network blip — keep polling
      }

      if (!cancelled) {
        // mild exponential backoff after 10 quiet polls (caps at 15s)
        const backoff = Math.min(intervalMs * Math.pow(1.15, Math.max(0, pollCount.current - 10)), 15_000)
        timerRef.current = setTimeout(poll, backoff)
      }
    }

    poll()

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [hasPending, intervalMs, router])

  return null
}
