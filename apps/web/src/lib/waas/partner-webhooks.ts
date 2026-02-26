/**
 * Partner Webhook Notification System
 * Sends webhook events to partners and logs delivery attempts.
 * Supports retry with exponential backoff (up to 3 attempts).
 */

import crypto from 'crypto'
import { eq, and, lte, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { partnerWebhookEvents, partners } from '@ntzs/db'

export interface WebhookEventPayload {
  event: string
  data: Record<string, unknown>
  timestamp: string
}

/**
 * Queue a webhook event for delivery to a partner
 */
export async function queuePartnerWebhook(
  partnerId: string,
  eventType: string,
  data: Record<string, unknown>
): Promise<void> {
  const { db } = getDb()

  const payload: WebhookEventPayload = {
    event: eventType,
    data,
    timestamp: new Date().toISOString(),
  }

  await db.insert(partnerWebhookEvents).values({
    partnerId,
    eventType,
    payload,
    status: 'pending',
    attempts: 0,
    nextRetryAt: new Date(),
  })
}

/**
 * Sign a webhook payload with HMAC-SHA256
 */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Process pending webhook events — call this from a cron job or background loop
 */
export async function processWebhookQueue(): Promise<number> {
  const { db } = getDb()

  // Get pending events that are ready for (re)delivery
  const pendingEvents = await db
    .select({
      eventId: partnerWebhookEvents.id,
      partnerId: partnerWebhookEvents.partnerId,
      payload: partnerWebhookEvents.payload,
      attempts: partnerWebhookEvents.attempts,
      webhookUrl: partners.webhookUrl,
      webhookSecret: partners.webhookSecret,
    })
    .from(partnerWebhookEvents)
    .innerJoin(partners, eq(partnerWebhookEvents.partnerId, partners.id))
    .where(
      and(
        eq(partnerWebhookEvents.status, 'pending'),
        lte(partnerWebhookEvents.nextRetryAt, new Date())
      )
    )
    .orderBy(partnerWebhookEvents.createdAt)
    .limit(20)

  let delivered = 0

  for (const event of pendingEvents) {
    if (!event.webhookUrl) {
      // No webhook URL configured — mark as failed silently
      await db
        .update(partnerWebhookEvents)
        .set({ status: 'failed', lastAttemptAt: new Date() })
        .where(eq(partnerWebhookEvents.id, event.eventId))
      continue
    }

    const newAttempts = event.attempts + 1
    const payloadStr = JSON.stringify(event.payload)
    const timestamp = Math.floor(Date.now() / 1000).toString()

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Timestamp': timestamp,
    }

    // Sign if partner has a webhook secret
    if (event.webhookSecret) {
      const signedPayload = `${timestamp}.${payloadStr}`
      headers['X-Webhook-Signature'] = signPayload(signedPayload, event.webhookSecret)
    }

    try {
      const response = await fetch(event.webhookUrl, {
        method: 'POST',
        headers,
        body: payloadStr,
        signal: AbortSignal.timeout(10000), // 10s timeout
      })

      if (response.ok) {
        await db
          .update(partnerWebhookEvents)
          .set({
            status: 'delivered',
            attempts: newAttempts,
            lastAttemptAt: new Date(),
            responseStatus: response.status,
          })
          .where(eq(partnerWebhookEvents.id, event.eventId))
        delivered++
      } else {
        // Non-2xx — schedule retry or mark as failed
        await handleRetry(event.eventId, newAttempts, response.status)
      }
    } catch (err) {
      console.error('[partner-webhooks] delivery error:', event.eventId, err instanceof Error ? err.message : err)
      await handleRetry(event.eventId, newAttempts, null)
    }
  }

  return delivered
}

const MAX_ATTEMPTS = 3

async function handleRetry(
  eventId: string,
  attempts: number,
  responseStatus: number | null
): Promise<void> {
  const { db } = getDb()

  if (attempts >= MAX_ATTEMPTS) {
    await db
      .update(partnerWebhookEvents)
      .set({
        status: 'failed',
        attempts,
        lastAttemptAt: new Date(),
        responseStatus,
      })
      .where(eq(partnerWebhookEvents.id, eventId))
    return
  }

  // Exponential backoff: 30s, 120s, 480s
  const delayMs = 30000 * Math.pow(4, attempts - 1)
  const nextRetry = new Date(Date.now() + delayMs)

  await db
    .update(partnerWebhookEvents)
    .set({
      attempts,
      lastAttemptAt: new Date(),
      nextRetryAt: nextRetry,
      responseStatus,
    })
    .where(eq(partnerWebhookEvents.id, eventId))
}
