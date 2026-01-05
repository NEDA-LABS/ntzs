'use client'

import type { ReactNode } from 'react'
import { useMemo, useCallback } from 'react'
import { CDPHooksProvider, type Config } from '@coinbase/cdp-hooks'

import { authClient } from '@/lib/auth/client'

export function CdpProvider({
  children,
  enabled = true,
}: {
  children: ReactNode
  enabled?: boolean
}) {
  const projectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID

  const getJwt = useCallback(async () => {
    try {
      const tokenResult = await authClient.token()
      const jwt = tokenResult.data?.token
      if (jwt) {
        console.log('[CDP] Got JWT from authClient.token()')
        return jwt
      }

      const sessionResult = await authClient.getSession()
      const sessionToken = sessionResult.data?.session?.token
      if (sessionToken) {
        console.log('[CDP] Got JWT from session')
        return sessionToken
      }

      const tokenErr = tokenResult.error
      const sessionErr = sessionResult.error
      const errorMsg = tokenErr?.message ?? sessionErr?.message ?? 'Unable to retrieve Neon Auth token'
      console.error('[CDP] JWT retrieval failed:', errorMsg)
      throw new Error(errorMsg)
    } catch (err) {
      console.error('[CDP] getJwt error:', err)
      throw err
    }
  }, [])

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

    return {
      projectId,
      appName: 'nTZS',
      customAuth: {
        getJwt,
      },
      onError: handleError,
    }
  }, [enabled, projectId, getJwt, handleError])

  if (!config) {
    return children
  }

  return <CDPHooksProvider config={config}>{children}</CDPHooksProvider>
}
