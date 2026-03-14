'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  hasPending: boolean
  intervalMs?: number
}

/**
 * Silently polls the server every `intervalMs` while there are pending deposits.
 * Uses router.refresh() to re-run server components and pick up status changes
 * (e.g. mint_pending -> minted) without a full page reload.
 * Stops polling automatically once hasPending becomes false.
 */
export function PendingDepositPoller({ hasPending, intervalMs = 3000 }: Props) {
  const router = useRouter()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!hasPending) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    intervalRef.current = setInterval(() => {
      router.refresh()
    }, intervalMs)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [hasPending, intervalMs, router])

  return null
}
