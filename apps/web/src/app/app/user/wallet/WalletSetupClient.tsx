'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  useAuthenticateWithJWT,
  useCreateEvmEoaAccount,
  useCurrentUser,
  useEvmAddress,
  useIsInitialized,
} from '@coinbase/cdp-hooks'

import { saveEmbeddedWalletAction } from './actions'

type UiStatus = 'idle' | 'creating'

export function WalletSetupClient() {
  const { isInitialized } = useIsInitialized()
  const { currentUser } = useCurrentUser()
  const { evmAddress } = useEvmAddress()
  const { authenticateWithJWT } = useAuthenticateWithJWT()
  const { createEvmEoaAccount } = useCreateEvmEoaAccount()

  const [status, setStatus] = useState<UiStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string>('')

  const canCreate = isInitialized && !evmAddress

  const addressToSave = useMemo(() => {
    if (!evmAddress) return ''
    return String(evmAddress)
  }, [evmAddress])

  // Single unified flow: authenticate + create wallet
  async function handleCreateWallet() {
    setError(null)
    setStatus('creating')

    try {
      // Step 1: Authenticate with JWT if not already authenticated
      if (!currentUser) {
        setStatusMessage('Authenticating...')
        await authenticateWithJWT()
      }

      // Step 2: Create the embedded wallet
      setStatusMessage('Creating your secure wallet...')
      await createEvmEoaAccount()

      setStatusMessage('Wallet created successfully!')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create wallet'
      setError(message)
      setStatusMessage('')
    } finally {
      setStatus('idle')
    }
  }

  // Clear status message after wallet is created
  useEffect(() => {
    if (evmAddress && statusMessage === 'Wallet created successfully!') {
      const timer = setTimeout(() => setStatusMessage(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [evmAddress, statusMessage])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="text-sm font-semibold">Status</div>
        <div className="mt-2 text-sm text-white/70">
          {!isInitialized && 'Preparing wallet services…'}
          {isInitialized && !evmAddress && 'Ready to create your wallet.'}
          {isInitialized && evmAddress && 'Your wallet is set up.'}
        </div>
        {statusMessage && <div className="mt-2 text-sm text-blue-300">{statusMessage}</div>}
        {error && (
          <div className="mt-2 text-sm text-red-300">
            <div className="font-medium">Error:</div>
            <div className="mt-1 break-all">{error}</div>
            <div className="mt-2 text-xs text-white/50">Check browser console (F12) for details</div>
          </div>
        )}
      </div>

      {evmAddress ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="text-sm font-semibold">Your wallet address</div>
          <div className="mt-2 break-all font-mono text-xs text-white/70">{String(evmAddress)}</div>

          <form action={saveEmbeddedWalletAction} className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="address" value={addressToSave} />
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90"
            >
              Save wallet to account
            </button>
          </form>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="text-sm font-semibold">Set up your wallet</div>
          <div className="mt-2 text-sm text-white/70">
            Create a secure embedded wallet to hold your nTZS and receive settlements.
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleCreateWallet}
              disabled={!canCreate || status !== 'idle'}
              className="inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-60"
            >
              {status === 'creating' ? 'Creating...' : 'Create wallet'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
