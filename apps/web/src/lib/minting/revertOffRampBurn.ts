import { ethers } from 'ethers'

import { getDb } from '@/lib/db'
import {
  BASE_RPC_URL,
  NTZS_CONTRACT_ADDRESS_BASE,
  MINTER_PRIVATE_KEY,
  BURNER_PRIVATE_KEY,
  PLATFORM_TREASURY_ADDRESS,
} from '@/lib/env'
import { auditLogs } from '@ntzs/db'

const NTZS_ABI = [
  'function burn(address from, uint256 amount)',
  'function mint(address to, uint256 amount)',
] as const

/**
 * Re-mint a failed off-ramp burn back to the user's wallet and, if a
 * platform fee was also minted, burn that fee back from its recipient so
 * the reserve stays balanced. Idempotency is the caller's responsibility —
 * guard with the burnRequests.payoutStatus state machine so this runs at
 * most once per burn.
 */
export async function revertOffRampBurn(args: {
  burnRequestId: string
  userAddress: string
  burnAmountTzs: number
  platformFeeTzs: number | null
  feeRecipientAddress: string | null
  feeMintOccurred: boolean
  /** Ramp corridor: NEDA's share of the platform fee, minted separately. */
  nedaFeeTzs?: number | null
  nedaFeeRecipientAddress?: string | null
  nedaFeeMintOccurred?: boolean
  reason: string
}): Promise<{ remintTxHash?: string; feeBurnTxHash?: string; nedaFeeBurnTxHash?: string; error?: string }> {
  const {
    burnRequestId,
    userAddress,
    burnAmountTzs,
    platformFeeTzs,
    feeRecipientAddress,
    feeMintOccurred,
    nedaFeeTzs,
    nedaFeeRecipientAddress,
    nedaFeeMintOccurred,
    reason,
  } = args

  if (!BASE_RPC_URL || !NTZS_CONTRACT_ADDRESS_BASE) {
    return { error: 'Blockchain configuration missing' }
  }
  if (!MINTER_PRIVATE_KEY) {
    return { error: 'Minter key not configured — cannot revert burn' }
  }

  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
  const minter = new ethers.Wallet(MINTER_PRIVATE_KEY, provider)
  const tokenAsMinter = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, NTZS_ABI, minter)

  const amountWei = BigInt(Math.trunc(burnAmountTzs)) * (BigInt(10) ** BigInt(18))

  let remintTxHash: string | undefined
  try {
    const tx = await tokenAsMinter.mint(userAddress, amountWei)
    await tx.wait(1)
    remintTxHash = tx.hash
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { error: `remint_failed: ${message}` }
  }

  // If a fee was minted, burn it back from each recipient so the reserve stays
  // net-zero for this reverted withdrawal. The platform fee may be split across
  // the partner and the NEDA treasury — burn back whichever legs actually minted.
  const burnerKey = BURNER_PRIVATE_KEY || MINTER_PRIVATE_KEY
  const burnBackFee = async (
    label: string, amountTzs: number | null | undefined, recipient: string | null | undefined, occurred: boolean | undefined,
  ): Promise<string | undefined> => {
    if (!occurred || !amountTzs || amountTzs <= 0 || !recipient) return undefined
    try {
      const burner = new ethers.Wallet(burnerKey, provider)
      const tokenAsBurner = new ethers.Contract(NTZS_CONTRACT_ADDRESS_BASE, NTZS_ABI, burner)
      const feeWei = BigInt(amountTzs) * (BigInt(10) ** BigInt(18))
      const tx = await tokenAsBurner.burn(recipient, feeWei)
      await tx.wait(1)
      return tx.hash
    } catch (err) {
      // Non-fatal: user is made whole, but operator must reconcile the fee dust.
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[revertOffRampBurn] ${label} fee burn failed — reserve has fee dust`, {
        burnRequestId, amountTzs, recipient, error: message,
      })
      return undefined
    }
  }

  // NEDA's share always mints to the platform treasury, so default the recipient
  // for callers (webhooks/reconcile) that only carry the amount + occurred flag.
  const effectiveNedaRecipient = nedaFeeRecipientAddress
    ?? (ethers.isAddress(PLATFORM_TREASURY_ADDRESS) ? PLATFORM_TREASURY_ADDRESS : null)
  const feeBurnTxHash = await burnBackFee('partner', platformFeeTzs, feeRecipientAddress, feeMintOccurred)
  const nedaFeeBurnTxHash = await burnBackFee('neda', nedaFeeTzs, effectiveNedaRecipient, nedaFeeMintOccurred)

  const { db } = getDb()
  await db.insert(auditLogs).values({
    action: 'offramp_burn_reverted',
    entityType: 'burn_request',
    entityId: burnRequestId,
    metadata: {
      burnAmountTzs,
      platformFeeTzs,
      feeRecipientAddress,
      nedaFeeTzs,
      nedaFeeRecipientAddress,
      remintTxHash,
      feeBurnTxHash,
      nedaFeeBurnTxHash,
      reason,
    },
  })

  return { remintTxHash, feeBurnTxHash, nedaFeeBurnTxHash }
}
