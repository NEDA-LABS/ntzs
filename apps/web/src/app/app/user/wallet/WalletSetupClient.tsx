'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  useSignInWithEmail,
  useVerifyEmailOTP,
  useCreateEvmEoaAccount,
  useCurrentUser,
  useEvmAddress,
  useIsInitialized,
} from '@coinbase/cdp-hooks'

import { saveEmbeddedWalletAction } from './actions'

type UiStatus = 'idle' | 'entering-email' | 'entering-otp' | 'creating'

export function WalletSetupClient() {
  const { isInitialized } = useIsInitialized()
  const { currentUser } = useCurrentUser()
  const { evmAddress } = useEvmAddress()
  const { signInWithEmail } = useSignInWithEmail()
  const { verifyEmailOTP } = useVerifyEmailOTP()
  const { createEvmEoaAccount } = useCreateEvmEoaAccount()

  const [status, setStatus] = useState<UiStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [email, setEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [flowId, setFlowId] = useState('')

  const canCreate = isInitialized && !evmAddress

  const addressToSave = useMemo(() => {
    if (!evmAddress) return ''
    return String(evmAddress)
  }, [evmAddress])

  // Step 1: Start authentication - enter email
  function handleStartAuth() {
    setError(null)
    setStatus('entering-email')
  }

  // Step 2: Send OTP to email
  async function handleSendOTP(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    
    try {
      setStatusMessage('Sending verification code...')
      const result = await signInWithEmail({ email })
      setFlowId(result.flowId)
      setStatus('entering-otp')
      setStatusMessage('Check your email for the verification code.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send OTP'
      setError(message)
      setStatusMessage('')
    }
  }

  // Step 3: Verify OTP and create wallet
  async function handleVerifyAndCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus('creating')

    try {
      // Verify OTP
      setStatusMessage('Verifying code...')
      await verifyEmailOTP({ flowId, otp: otpCode })

      // Create the embedded wallet if not already created
      if (!evmAddress) {
        setStatusMessage('Creating your secure wallet...')
        await createEvmEoaAccount()
      }

      setStatusMessage('Wallet created successfully!')
      setStatus('idle')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to verify or create wallet'
      setError(message)
      setStatusMessage('')
      setStatus('entering-otp') // Stay on OTP step for retry
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

          {status === 'idle' && (
            <div className="mt-4">
              <button
                type="button"
                onClick={handleStartAuth}
                disabled={!canCreate}
                className="inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-60"
              >
                Create wallet
              </button>
            </div>
          )}

          {status === 'entering-email' && (
            <form onSubmit={handleSendOTP} className="mt-4 flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                className="h-11 rounded-lg border border-white/20 bg-black/40 px-4 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90"
              >
                Send verification code
              </button>
            </form>
          )}

          {status === 'entering-otp' && (
            <form onSubmit={handleVerifyAndCreate} className="mt-4 flex flex-col gap-3">
              <div className="text-sm text-white/70">
                Enter the 6-digit code sent to <span className="font-medium text-white">{email}</span>
              </div>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="Enter 6-digit code"
                maxLength={6}
                required
                className="h-11 rounded-lg border border-white/20 bg-black/40 px-4 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90"
              >
                Verify & Create Wallet
              </button>
            </form>
          )}

          {status === 'creating' && (
            <div className="mt-4 text-sm text-white/70">
              Please wait...
            </div>
          )}
        </div>
      )}
    </div>
  )
}
