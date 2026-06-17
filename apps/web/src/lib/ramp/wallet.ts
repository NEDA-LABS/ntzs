import { ethers } from 'ethers'
import { eq, and, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { partners, partnerSubWallets } from '@ntzs/db'
import { deriveSubWalletAddress, deriveSubWallet } from '@/lib/waas/hd-wallets'
import { BASE_RPC_URL } from '@/lib/env'

/** Each partner gets ONE ramp settlement sub-wallet — their pre-funded USDC float. */
export const RAMP_SETTLEMENT_LABEL = 'ramp_settlement'

// USDC on Base (6 decimals).
export const USDC_BASE = { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 }
const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'] as const

export interface SettlementWallet {
  address: string
  walletIndex: number
}

/**
 * Get (or first-time provision) the partner's ramp settlement sub-wallet.
 * Derived from the partner HD seed like any other sub-wallet (index 1+).
 */
export async function getOrCreateSettlementWallet(partnerId: string): Promise<SettlementWallet> {
  const { db } = getDb()

  const [existing] = await db
    .select({ address: partnerSubWallets.address, walletIndex: partnerSubWallets.walletIndex })
    .from(partnerSubWallets)
    .where(and(eq(partnerSubWallets.partnerId, partnerId), eq(partnerSubWallets.label, RAMP_SETTLEMENT_LABEL)))
    .limit(1)
  if (existing) return existing

  const [partner] = await db
    .select({ encryptedHdSeed: partners.encryptedHdSeed })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)
  if (!partner?.encryptedHdSeed) {
    throw new Error('Partner HD seed not configured — cannot provision a settlement wallet')
  }

  // Claim the next sub-wallet index atomically (index 0 = main treasury).
  const [claim] = await db
    .update(partners)
    .set({ nextSubWalletIndex: sql`${partners.nextSubWalletIndex} + 1`, updatedAt: new Date() })
    .where(eq(partners.id, partnerId))
    .returning({ next: partners.nextSubWalletIndex })
  const walletIndex = (claim?.next ?? 2) - 1

  const address = deriveSubWalletAddress(partner.encryptedHdSeed, walletIndex)

  await db.insert(partnerSubWallets).values({
    partnerId,
    label: RAMP_SETTLEMENT_LABEL,
    address,
    walletIndex,
  })

  return { address, walletIndex }
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
