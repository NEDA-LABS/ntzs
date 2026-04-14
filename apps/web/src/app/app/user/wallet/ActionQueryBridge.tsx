'use client'

import { useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

export function ActionQueryBridge() {
  const params = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const action = params.get('action')
    if (!action) return

    const map: Record<string, string> = {
      receive: 'wallet:openReceive',
      send: 'wallet:openSend',
      swap: 'wallet:openSwap',
      withdraw: 'wallet:openWithdraw',
    }

    const evt = map[action]
    if (evt) {
      // Defer to allow page mount
      setTimeout(() => {
        window.dispatchEvent(new Event(evt))
        // Clean the query param so reloads don't retrigger
        const url = new URL(window.location.href)
        url.searchParams.delete('action')
        router.replace(url.pathname + (url.search ? '?' + url.searchParams.toString() : ''))
      }, 0)
    }
  }, [params, router])

  return null
}
