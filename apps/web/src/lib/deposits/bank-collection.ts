import { and, eq } from 'drizzle-orm'

import { depositRequests } from '@ntzs/db'
import {
  BANK_CHANNEL,
  W2B_MATCH_WINDOW_HOURS,
  formatBankReference,
  generateBankReference,
} from '@/lib/psp/selcom-statement'
import type { BankCollectionConfig } from '@/lib/psp/selcom-w2b'

type Db = ReturnType<typeof import('@/lib/db').getDb>['db']

/**
 * Allocate a bank-transfer reference token no OPEN intent is already using.
 * Collisions are ~1 in 30^6 so the loop exists for correctness, not because
 * it is expected to iterate; the matcher additionally refuses to auto-match
 * when two open intents somehow share a token.
 */
export async function allocateBankReference(db: Db): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateBankReference()
    const [clash] = await db
      .select({ id: depositRequests.id })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.status, 'submitted'),
          eq(depositRequests.pspChannel, BANK_CHANNEL),
          eq(depositRequests.pspReference, token)
        )
      )
      .limit(1)
    if (!clash) return token
  }
  throw new Error('Failed to allocate a unique bank reference')
}

/**
 * The payment-instructions block returned to API callers — one builder so the
 * live route and test mode describe the transfer identically.
 */
export function bankTransferInstructions(cfg: BankCollectionConfig, token: string, amountTzs: number) {
  return {
    institution: cfg.institution,
    accountNumber: cfg.accountNumber,
    accountName: cfg.accountName,
    reference: formatBankReference(token),
    amountTzs,
    note:
      `Send a bank transfer (TIPS) of EXACTLY this amount to this account and put the reference ${formatBankReference(token)} ` +
      'in the transfer description/narration — it is how the payment is matched. nTZS mints automatically once the credit ' +
      `appears on our settlement account statement, typically within ~10 minutes. The reference is valid for ${W2B_MATCH_WINDOW_HOURS} hours; ` +
      'transfers without it (or with a different amount) are held for manual review instead of auto-crediting.',
  }
}
