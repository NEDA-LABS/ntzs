import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireServiceKey } from '@/lib/service-auth'
import { db } from '@/lib/merchant/db'
import { merchantAccounts, merchantAiUsage, merchantCollections, merchantPaymentLinks, merchantPlatformFees } from '@ntzs/db'
import { and, count, desc, eq, gte, sql, sum } from 'drizzle-orm'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const FREE_MONTHLY_REQUESTS = 20
const AI_FEE_TZS = 500          // charged per request after free tier
const ALERT_AT_REMAINING = 5    // alert merchant when this many free requests remain

function currentPeriod(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function buildSystem(agentName: string) {
  return `You are ${agentName} — a business-savvy friend helping a merchant sell more on the nTZS platform.

Be casual and direct. Short replies, like WhatsApp. No bullet lists or formal language. Mix in a bit of Swahili naturally — sawa, nzuri, kabisa, asante, pole — but keep it light.

When someone sends a photo of something they want to sell, just look at it and figure out what it is, suggest a name and fair price in TZS, then use propose_product right away. Don't wait for permission.

When someone says they want to add a product, use propose_product immediately — don't list steps or ask if they want help.

For promos, make them sound genuinely exciting and a bit urgent. For sharing, write WhatsApp messages that sound like they came from a real person, not a marketing team.

If the price is missing, ask quick — one line. Then go.`
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_products',
    description: "Get merchant's active products with names, prices, and share links",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_sales_summary',
    description: 'Get sales stats: total, this month, today, and last few orders',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'propose_product',
    description: 'Draft a product for the merchant to tap-confirm. Use this immediately when a merchant wants to add anything.',
    input_schema: {
      type: 'object' as const,
      properties: {
        productName: { type: 'string' },
        type: { type: 'string', enum: ['fixed', 'open'] },
        amountTzs: { type: 'number' },
        description: { type: 'string' },
        imageUrl: { type: 'string' },
      },
      required: ['productName', 'type'],
    },
  },
  {
    name: 'propose_promo',
    description: 'Draft a discounted version of a product for the merchant to confirm.',
    input_schema: {
      type: 'object' as const,
      properties: {
        productName: { type: 'string' },
        originalAmountTzs: { type: 'number' },
        discountPct: { type: 'number', description: '1–99' },
        description: { type: 'string' },
        imageUrl: { type: 'string' },
      },
      required: ['productName', 'originalAmountTzs', 'discountPct'],
    },
  },
]

type ProposedAction =
  | { type: 'create_product'; data: Record<string, unknown> }
  | { type: 'create_promo'; data: Record<string, unknown> }

async function runTool(
  merchantId: string,
  handle: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ result: string; action?: ProposedAction }> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.ntzs.co.tz'

  if (toolName === 'list_products') {
    const links = await db
      .select()
      .from(merchantPaymentLinks)
      .where(and(eq(merchantPaymentLinks.merchantId, merchantId), eq(merchantPaymentLinks.isActive, true)))
      .orderBy(desc(merchantPaymentLinks.createdAt))
      .limit(20)

    if (!links.length) return { result: 'No products yet.' }

    const list = links.map(l => {
      const price = l.amountTzs ? `${l.amountTzs.toLocaleString()} TZS` : 'open amount'
      const promo = l.discountPct > 0 ? ` (-${l.discountPct}%)` : ''
      return `${l.productName || 'Unnamed'} — ${price}${promo}\n${baseUrl}/m/${handle}?link=${l.id}`
    }).join('\n\n')

    return { result: `${links.length} product(s):\n\n${list}` }
  }

  if (toolName === 'get_sales_summary') {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [totals] = await db.select({ total: sum(merchantCollections.amountTzs) }).from(merchantCollections)
      .where(and(eq(merchantCollections.merchantId, merchantId), eq(merchantCollections.collectionStatus, 'minted')))
    const [today] = await db.select({ total: sum(merchantCollections.amountTzs) }).from(merchantCollections)
      .where(and(eq(merchantCollections.merchantId, merchantId), eq(merchantCollections.collectionStatus, 'minted'), gte(merchantCollections.createdAt, startOfDay)))
    const [month] = await db.select({ total: sum(merchantCollections.amountTzs) }).from(merchantCollections)
      .where(and(eq(merchantCollections.merchantId, merchantId), eq(merchantCollections.collectionStatus, 'minted'), gte(merchantCollections.createdAt, startOfMonth)))
    const [activeLinks] = await db.select({ count: count() }).from(merchantPaymentLinks)
      .where(and(eq(merchantPaymentLinks.merchantId, merchantId), eq(merchantPaymentLinks.isActive, true)))
    const recent = await db.select().from(merchantCollections)
      .where(eq(merchantCollections.merchantId, merchantId))
      .orderBy(desc(merchantCollections.createdAt)).limit(3)

    const recentStr = recent.length
      ? recent.map(c => `${c.payerName || 'Someone'} paid ${c.amountTzs.toLocaleString()} TZS`).join(', ')
      : 'no orders yet'

    return {
      result: `All time: ${Number(totals?.total ?? 0).toLocaleString()} TZS. This month: ${Number(month?.total ?? 0).toLocaleString()} TZS. Today: ${Number(today?.total ?? 0).toLocaleString()} TZS. Active products: ${activeLinks?.count ?? 0}. Recent: ${recentStr}.`,
    }
  }

  if (toolName === 'propose_product') {
    const d = toolInput as { productName: string; type: string; amountTzs?: number; description?: string; imageUrl?: string }
    return {
      result: `Drafted "${d.productName}"${d.amountTzs ? ` at ${d.amountTzs.toLocaleString()} TZS` : ''}. Ready for merchant to confirm.`,
      action: { type: 'create_product', data: { ...d } },
    }
  }

  if (toolName === 'propose_promo') {
    const d = toolInput as { productName: string; originalAmountTzs: number; discountPct: number; description?: string; imageUrl?: string }
    const discountedPrice = Math.round(d.originalAmountTzs * (1 - d.discountPct / 100))
    return {
      result: `Promo drafted: "${d.productName}" ${d.discountPct}% off → ${discountedPrice.toLocaleString()} TZS. Ready for merchant to confirm.`,
      action: { type: 'create_promo', data: { ...d, amountTzs: discountedPrice } },
    }
  }

  return { result: 'Unknown tool.' }
}

export async function POST(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  const merchantId = req.headers.get('x-merchant-id')
  if (!merchantId) return NextResponse.json({ error: 'x-merchant-id header required' }, { status: 400 })

  const body = await req.json() as { messages: Anthropic.MessageParam[]; agentName?: string }
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 })
  }

  const [account] = await db
    .select({ handle: merchantAccounts.handle })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, merchantId))
    .limit(1)

  if (!account) return NextResponse.json({ error: 'Merchant not found' }, { status: 404 })

  // ── Billing ──────────────────────────────────────────────────────────────────
  //
  // Best-effort: if the merchant_ai_usage table isn't migrated yet (or any
  // billing write fails) we log and serve the request for free rather than
  // returning an empty 500. `billingReady` gates the later token-usage write.

  const period = currentPeriod()
  let usedThisMonth = 0
  let isPaid = false
  let billingReady = true

  try {
    // Get or initialise the monthly usage row
    const [usage] = await db
      .insert(merchantAiUsage)
      .values({ merchantId, period })
      .onConflictDoNothing()
      .returning()

    const [currentUsage] = usage
      ? [usage]
      : await db
          .select({ requestCount: merchantAiUsage.requestCount, paidRequestCount: merchantAiUsage.paidRequestCount })
          .from(merchantAiUsage)
          .where(and(eq(merchantAiUsage.merchantId, merchantId), eq(merchantAiUsage.period, period)))
          .limit(1)

    usedThisMonth = currentUsage?.requestCount ?? 0
    isPaid = usedThisMonth >= FREE_MONTHLY_REQUESTS

    if (isPaid) {
      // Atomically deduct from settlement balance — fails if balance insufficient
      const [deducted] = await db
        .update(merchantAccounts)
        .set({
          settlementPendingTzs: sql`${merchantAccounts.settlementPendingTzs} - ${AI_FEE_TZS}`,
          updatedAt: new Date(),
        })
        .where(and(eq(merchantAccounts.id, merchantId), gte(merchantAccounts.settlementPendingTzs, AI_FEE_TZS)))
        .returning({ newBalance: merchantAccounts.settlementPendingTzs })

      if (!deducted) {
        return NextResponse.json(
          {
            error: 'insufficient_balance',
            message: `Mkoba wako una TZS chache sana. Unahitaji angalau ${AI_FEE_TZS.toLocaleString()} TZS kuendelea kutumia Ubongo AI.`,
          },
          { status: 402 },
        )
      }

      // Record fee in platform treasury ledger
      await db.insert(merchantPlatformFees).values({
        merchantId,
        amountTzs: AI_FEE_TZS,
        reason: 'ai_chat',
        metadata: { period, requestNumber: usedThisMonth + 1 },
      })
    }

    // Increment monthly usage counters
    await db
      .update(merchantAiUsage)
      .set({
        requestCount: sql`${merchantAiUsage.requestCount} + 1`,
        freeRequestCount: isPaid ? merchantAiUsage.freeRequestCount : sql`${merchantAiUsage.freeRequestCount} + 1`,
        paidRequestCount: isPaid ? sql`${merchantAiUsage.paidRequestCount} + 1` : merchantAiUsage.paidRequestCount,
        totalFeeTzs: isPaid ? sql`${merchantAiUsage.totalFeeTzs} + ${AI_FEE_TZS}` : merchantAiUsage.totalFeeTzs,
        updatedAt: new Date(),
      })
      .where(and(eq(merchantAiUsage.merchantId, merchantId), eq(merchantAiUsage.period, period)))
  } catch (err) {
    console.error('[biashara/ai/chat] billing unavailable — serving without billing:', err instanceof Error ? err.message : err)
    billingReady = false
    usedThisMonth = 0
    isPaid = false
  }

  // Alert when the merchant has ALERT_AT_REMAINING free requests left
  const freeRemaining = Math.max(0, FREE_MONTHLY_REQUESTS - (usedThisMonth + 1))
  const alert =
    !isPaid && freeRemaining === ALERT_AT_REMAINING
      ? `Umebakiwa na maombi ${ALERT_AT_REMAINING} ya bure kwa mwezi huu. Baada ya hapo, kila ombi litagharimu ${AI_FEE_TZS.toLocaleString()} TZS kutoka kwenye mkoba wako.`
      : isPaid
      ? `Umegharimia ${AI_FEE_TZS.toLocaleString()} TZS kwa ombi hili.`
      : null

  // ── AI Inference ─────────────────────────────────────────────────────────────

  let pendingAction: ProposedAction | undefined
  let currentMessages = [...body.messages]

  try {
    for (let i = 0; i < 5; i++) {
      const response = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: buildSystem(body.agentName ?? 'Ubongo AI'),
        tools: TOOLS,
        messages: currentMessages,
      })

      // Update token usage in the ledger row (best-effort; skip if billing is down)
      if (billingReady) {
        await db
          .update(merchantAiUsage)
          .set({
            totalTokens: sql`${merchantAiUsage.totalTokens} + ${response.usage.input_tokens + response.usage.output_tokens}`,
            updatedAt: new Date(),
          })
          .where(and(eq(merchantAiUsage.merchantId, merchantId), eq(merchantAiUsage.period, period)))
          .catch(() => {})
      }

      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find(b => b.type === 'text')
        return NextResponse.json({
          reply: textBlock?.type === 'text' ? textBlock.text : '',
          action: pendingAction ?? null,
          alert,
          usage: { freeRemaining, isPaid },
        })
      }

      if (response.stop_reason === 'tool_use') {
        currentMessages = [...currentMessages, { role: 'assistant', content: response.content }]
        const toolResults: Anthropic.ToolResultBlockParam[] = []

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue
          const { result, action } = await runTool(merchantId, account.handle, block.name, block.input as Record<string, unknown>)
          if (action) pendingAction = action
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
        }

        currentMessages = [...currentMessages, { role: 'user', content: toolResults }]
        continue
      }

      break
    }
  } catch (err) {
    // Any inference error (model, rate limit, network) returns readable JSON
    // instead of an empty 500.
    console.error('[biashara/ai/chat] inference failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI inference failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ reply: 'Kuna tatizo kidogo — jaribu tena.', action: null, alert, usage: { freeRemaining, isPaid } })
}
