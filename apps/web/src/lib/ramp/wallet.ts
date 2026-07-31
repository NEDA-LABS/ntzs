import { ethers } from 'ethers'
import { eq, and, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { partners, partnerSubWallets } from '@ntzs/db'
import { deriveSubWalletAddress, deriveSubWallet, generatePartnerSeed } from '@/lib/waas/hd-wallets'
import { BASE_RPC_URL } from '@/lib/env'

/** Each partner gets ONE ramp settlement sub-wallet — their pre-funded USDC float. */
export const RAMP_SETTLEMENT_LABEL = 'ramp_settlement'

// USDC on Base (6 decimals).
export const USDC_BASE = { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 }
const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const

export interface SettlementWallet {
  address: string
  walletIndex: number
  /** The seed the wallet derives from — provisioned here if the partner had none. */
  encryptedHdSeed: string
}

/**
 * Get (or first-time provision) the partner's ramp settlement sub-wallet.
 * Derived from the partner HD seed like any other sub-wallet (index 1+).
 *
 * A partner with no seed gets one HERE, the same lazy provisioning the WaaS
 * user path does. Seeds used to exist only once a partner created their first
 * WaaS user — a PURE ramp partner never does, so their very first API call
 * (/ramp/balance, for the funding address) died on 'HD seed not configured'.
 * Ramp onboarding must be complete with a live key + capability + KYB alone.
 */
export async function getOrCreateSettlementWallet(partnerId: string): Promise<SettlementWallet> {
  const { db } = getDb()

  const [existing] = await db
    .select({ address: partnerSubWallets.address, walletIndex: partnerSubWallets.walletIndex })
    .from(partnerSubWallets)
    .where(and(eq(partnerSubWallets.partnerId, partnerId), eq(partnerSubWallets.label, RAMP_SETTLEMENT_LABEL)))
    .limit(1)

  const [partner] = await db
    .select({ encryptedHdSeed: partners.encryptedHdSeed })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)
  if (!partner) throw new Error('Partner not found')

  let encryptedHdSeed = partner.encryptedHdSeed
  if (!encryptedHdSeed) {
    const { encryptedSeed: newSeed } = generatePartnerSeed()
    // Guard against a concurrent first-call racing us to the column: only
    // write if still empty, then re-read the winner.
    await db
      .update(partners)
      .set({ encryptedHdSeed: newSeed, updatedAt: new Date() })
      .where(and(eq(partners.id, partnerId), sql`${partners.encryptedHdSeed} is null`))
    const [after] = await db
      .select({ encryptedHdSeed: partners.encryptedHdSeed })
      .from(partners)
      .where(eq(partners.id, partnerId))
      .limit(1)
    encryptedHdSeed = after?.encryptedHdSeed ?? newSeed
  }

  if (existing) return { ...existing, encryptedHdSeed }

  // Claim the next sub-wallet index atomically (index 0 = main treasury).
  const [claim] = await db
    .update(partners)
    .set({ nextSubWalletIndex: sql`${partners.nextSubWalletIndex} + 1`, updatedAt: new Date() })
    .where(eq(partners.id, partnerId))
    .returning({ next: partners.nextSubWalletIndex })
  const walletIndex = (claim?.next ?? 2) - 1

  const address = deriveSubWalletAddress(encryptedHdSeed, walletIndex)

  await db.insert(partnerSubWallets).values({
    partnerId,
    label: RAMP_SETTLEMENT_LABEL,
    address,
    walletIndex,
  })

  return { address, walletIndex, encryptedHdSeed }
}

/** Signer for the partner's settlement sub-wallet (used to move USDC/nTZS during conversion). */
export function getSettlementSigner(encryptedHdSeed: string, walletIndex: number): ethers.HDNodeWallet {
  return deriveSubWallet(encryptedHdSeed, walletIndex)
}

/** On-chain USDC balance (float) of a settlement wallet, as a decimal string. */
export async function getSettlementUsdcBalance(address: string): Promise<string> {
  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
  const contract = new ethers.Contract(USDC_BASE.address, ERC20_BALANCE_ABI, provider)
  const raw: bigint = await contract.balanceOf(address)
  return ethers.formatUnits(raw, USDC_BASE.decimals)
}
