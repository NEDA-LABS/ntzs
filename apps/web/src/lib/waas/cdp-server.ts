/**
 * Server-side CDP Embedded Wallet Service
 *
 * Uses @coinbase/cdp-core with `customAuth.getJwt` to provision
 * embedded wallets and send on-chain transactions for WaaS users
 * without requiring user interaction (email OTP).
 *
 * Flow per user operation:
 * 1. Initialize CDP SDK with the target user's JWT via customAuth
 * 2. SDK internally authenticates and provisions wallet secrets
 * 3. Call createEvmEoaAccount / sendEvmTransaction
 */

import {
  initialize,
  authenticateWithJWT,
  createEvmEoaAccount,
  sendEvmTransaction,
  getCurrentUser,
  type SendEvmTransactionOptions,
} from '@coinbase/cdp-core'

import { signCDPToken } from '@/lib/cdp-jwt'

function getProjectId(): string {
  const id = process.env.NEXT_PUBLIC_CDP_PROJECT_ID
  if (!id) throw new Error('NEXT_PUBLIC_CDP_PROJECT_ID is not set')
  return id
}

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL) return 'https://ntzs.vercel.app'
  return 'http://localhost:3000'
}

/**
 * Initialize the CDP SDK authenticated as a specific user via customAuth JWT.
 * Each call re-initializes with a fresh JWT for the target user.
 */
async function initializeForUser(userId: string, email: string): Promise<void> {
  const baseUrl = getBaseUrl()

  await initialize({
    projectId: getProjectId(),
    customAuth: {
      getJwt: async () => {
        return signCDPToken({ sub: userId, email }, baseUrl, baseUrl)
      },
    },
  })

  // Trigger the actual authentication using the JWT provided by customAuth.getJwt
  await authenticateWithJWT()
}

/**
 * Provision a new CDP embedded wallet for a WaaS user.
 * Returns the EVM address, or reuses the existing one.
 */
export async function provisionWallet(
  userId: string,
  email: string
): Promise<{ address: string } | { error: string }> {
  try {
    await initializeForUser(userId, email)

    // Check if user already has a wallet from a prior session
    const currentUser = await getCurrentUser()
    if (currentUser?.evmAccounts && currentUser.evmAccounts.length > 0) {
      const address = currentUser.evmAccounts[0]
      console.log('[cdp-server] User already has wallet:', { userId, address })
      return { address: String(address) }
    }

    // Create new EOA account — CDP manages key material server-side
    const address = await createEvmEoaAccount()

    console.log('[cdp-server] Wallet provisioned:', { userId, address: String(address) })
    return { address: String(address) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[cdp-server] Wallet provisioning failed:', { userId, error: message })
    return { error: message }
  }
}

/**
 * Send an EVM transaction on behalf of a WaaS user.
 * Used for nTZS ERC-20 transfers between users.
 */
export async function sendTransaction(
  userId: string,
  email: string,
  options: SendEvmTransactionOptions
): Promise<{ txHash: string } | { error: string }> {
  try {
    await initializeForUser(userId, email)

    const result = await sendEvmTransaction(options)

    console.log('[cdp-server] Transaction sent:', {
      userId,
      txHash: result.transactionHash,
    })

    return { txHash: result.transactionHash }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[cdp-server] Transaction failed:', { userId, error: message })
    return { error: message }
  }
}
