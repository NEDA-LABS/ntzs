'use server'

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { requireDbUser } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { savingsPositions, savingsProducts, savingsTransactions, wallets } from '@ntzs/db'

export type DepositResult =
  | { success: true }
  | { success: false; error: string }

export async function depositToSavings(
  amountTzs: number,
  productId: string,
): Promise<DepositResult> {
  try {
    const dbUser = await requireDbUser()
    const { db } = getDb()

    // Resolve product
    const [product] = await db
      .select({
        id: savingsProducts.id,
        annualRateBps: savingsProducts.annualRateBps,
        minDepositTzs: savingsProducts.minDepositTzs,
        maxDepositTzs: savingsProducts.maxDepositTzs,
        status: savingsProducts.status,
      })
      .from(savingsProducts)
      .where(and(eq(savingsProducts.id, productId), eq(savingsProducts.status, 'active')))
      .limit(1)

    if (!product) return { success: false, error: 'Savings product is not available.' }

    // Validate amount
    const amount = Math.trunc(amountTzs)
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: 'Invalid amount.' }
    }
    if (product.minDepositTzs > 0 && amount < product.minDepositTzs) {
      return {
        success: false,
        error: `Minimum deposit is ${product.minDepositTzs.toLocaleString()} TZS.`,
      }
    }
    if (product.maxDepositTzs && amount > product.maxDepositTzs) {
      return {
        success: false,
        error: `Maximum deposit is ${product.maxDepositTzs.toLocaleString()} TZS.`,
      }
    }

    // Resolve user wallet
    const [wallet] = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(and(eq(wallets.userId, dbUser.id), eq(wallets.chain, 'base')))
      .limit(1)

    if (!wallet) return { success: false, error: 'No wallet found. Please set up your wallet first.' }

    // Upsert savings position
    const [existing] = await db
      .select({ id: savingsPositions.id })
      .from(savingsPositions)
      .where(
        and(
          eq(savingsPositions.userId, dbUser.id),
          eq(savingsPositions.productId, productId),
          eq(savingsPositions.status, 'active'),
        ),
      )
      .limit(1)

    let positionId: string

    if (existing) {
      await db
        .update(savingsPositions)
        .set({
          principalTzs: sql`${savingsPositions.principalTzs} + ${amount}`,
          totalDepositedTzs: sql`${savingsPositions.totalDepositedTzs} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(savingsPositions.id, existing.id))
      positionId = existing.id
    } else {
      const [newPos] = await db
        .insert(savingsPositions)
        .values({
          userId: dbUser.id,
          walletId: wallet.id,
          productId,
          principalTzs: amount,
          totalDepositedTzs: amount,
          annualRateBps: product.annualRateBps,
          status: 'active',
        })
        .returning({ id: savingsPositions.id })
      positionId = newPos.id
    }

    // Record the transaction
    await db.insert(savingsTransactions).values({
      positionId,
      userId: dbUser.id,
      type: 'deposit',
      status: 'completed',
      amountTzs: amount,
    })

    revalidatePath('/app/user/stake')
    return { success: true }
  } catch (err) {
    console.error('[depositToSavings]', err)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
}
