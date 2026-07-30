import { queuePartnerWebhook } from '@/lib/waas/partner-webhooks'

/**
 * Emit `spend.updated` to the owning partner when a spend reaches a terminal
 * state (completed / reverted / reconcile_required). The partner link and
 * disclosure snapshot live in the burn row's `spend` JSONB, so both the
 * inline execute path and the settlement cron can notify from the same shape
 * with no schema dependency.
 *
 * Fail-soft: a webhook problem must never affect the on-chain/reserve state
 * that already settled — queuePartnerWebhook only inserts a queued row, and
 * we swallow any error.
 */
export type SpendWebhookStatus = 'completed' | 'reverted' | 'reconcile_required'

export async function emitSpendWebhook(
  spend: Record<string, unknown> | null | undefined,
  args: {
    burnRequestId: string
    reference: string | null
    status: SpendWebhookStatus
    burnAmountTzs: number
  }
): Promise<void> {
  const partnerId = spend?.partnerId
  if (typeof partnerId !== 'string' || !partnerId) return // not a partner spend (or legacy row)

  try {
    await queuePartnerWebhook(partnerId, 'spend.updated', {
      // Mirrors the test-mode emitter, so a partner can route on one field
      // instead of on which API key happened to be in play.
      livemode: true,
      spendId: args.burnRequestId,
      externalId: typeof spend?.externalId === 'string' ? spend.externalId : null,
      reference: args.reference,
      status: args.status,
      kind: typeof spend?.kind === 'string' ? spend.kind : null,
      recipientName: typeof spend?.recipientName === 'string' ? spend.recipientName : null,
      principalTzs: typeof spend?.principalTzs === 'number' ? spend.principalTzs : null,
      burnAmountTzs: args.burnAmountTzs,
      actualChargesTzs: typeof spend?.actualChargesTzs === 'number' ? spend.actualChargesTzs : null,
      selcomReceipt: typeof spend?.selcomReceipt === 'string' ? spend.selcomReceipt : null,
      // For a utility purchase the TOKEN is the product — a completed webhook
      // without it is a payment whose deliverable went missing (30 Jul 2026:
      // the customer's LUKU tokens reached only our own Selcom Biz SMS).
      utilityToken: typeof spend?.utilityToken === 'string' ? spend.utilityToken : null,
      utilityUnits: typeof spend?.utilityUnits === 'string' ? spend.utilityUnits : null,
      utilityReceipt: typeof spend?.utilityReceipt === 'string' ? spend.utilityReceipt : null,
    })
  } catch (err) {
    console.error('[spend-webhook] queue failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}
