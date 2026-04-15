'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Mounts invisibly on the activity page.
 *
 * • Re-fetches the page data when any deposit or swap event fires.
 * • Also polls every 15 s unconditionally so the list never goes stale,
 *   regardless of whether PendingDepositPoller is running.
 */
export function ActivityRefreshListener() {
  const router = useRouter()

  useEffect(() => {
    const refresh = () => router.refresh()

    window.addEventListener('deposit:complete', refresh)
    window.addEventListener('deposit:failed',   refresh)
    window.addEventListener('swap:complete',    refresh)

    const interval = setInterval(refresh, 15_000)

    return () => {
      window.removeEventListener('deposit:complete', refresh)
      window.removeEventListener('deposit:failed',   refresh)
      window.removeEventListener('swap:complete',    refresh)
      clearInterval(interval)
    }
  }, [router])

  return null
}
