'use client'

import type { ReactNode } from 'react'
import { useMemo, useCallback } from 'react'
import { CDPHooksProvider, type Config } from '@coinbase/cdp-hooks'

export function CdpProvider({
  children,
  enabled = true,
}: {
  children: ReactNode
  enabled?: boolean
}) {
  const projectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID

  const handleError = useCallback((error: Error) => {
    console.error('[CDP] SDK Error:', error.message, error)
  }, [])

  const config = useMemo<Config | null>(() => {
    if (!enabled) return null
    if (!projectId) {
      console.warn('[CDP] Missing NEXT_PUBLIC_CDP_PROJECT_ID')
      return null
    }

    console.log('[CDP] Initializing with projectId:', projectId.slice(0, 8) + '...')

    // Use CDP's built-in authentication (email OTP)
    // After wallet creation, we'll link it to the Neon Auth user
    return {
      projectId,
      appName: 'nTZS',
      onError: handleError,
    }
  }, [enabled, projectId, handleError])

  if (!config) {
    return children
  }

  return <CDPHooksProvider config={config}>{children}</CDPHooksProvider>
}
