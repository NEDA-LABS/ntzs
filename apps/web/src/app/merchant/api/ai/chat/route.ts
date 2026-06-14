import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSessionFromCookies } from '@/lib/merchant/auth';
import { db } from '@/lib/merchant/db';
import { merchantCollections, merchantPaymentLinks, merchantAccounts } from '@ntzs/db';
import { and, count, desc, eq, gte, sum } from 'drizzle-orm';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystem(agentName: string) {
  return `You are ${agentName} — a business-savvy friend helping a merchant sell more on the nTZS platform.

Be casual and direct. Short replies, like WhatsApp. No bullet lists or formal language. Mix in a bit of Swahili naturally — sawa, nzuri, kabisa, asante, pole — but keep it light.

When someone sends a photo of something they want to sell, just look at it and figure out what it is, suggest a name and fair price in TZS, then use propose_product right away. Don't wait for permission.

When someone says they want to add a product, use propose_product immediately — don't list steps or ask if they want help.

For promos, make them sound genuinely exciting and a bit urgent. For sharing, write WhatsApp messages that sound like they came from a real person, not a marketing team.

If the price is missing, ask quick — one line. Then go.`;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_products',
    description: "Get merchant's active products with names, prices, and share links",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_sales_summary',
    description: "Get sales stats: total, this month, today, and last few orders",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'propose_product',
    description: 'Draft a product for the merchant to tap-confirm. Use this immediately when a merchant wants to add anything — with or without a photo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        productName: { type: 'string' },
        type: { type: 'string', enum: ['fixed', 'open'], description: 'fixed = set price, open = customer enters amount' },
        amountTzs: { type: 'number', description: 'Price in TZS (leave out if type is open)' },
        description: { type: 'string', description: 'One short line shown on the payment page' },
        imageUrl: { type: 'string', description: 'Image URL if one was provided' },
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
];

type ProposedAction =
  | { type: 'create_product'; data: Record<string, unknown> }
  | { type: 'create_promo'; data: Record<string, unknown> };

async function runTool(
  merchantId: string,
  handle: string,
  baseUrl: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ result: string; action?: ProposedAction }> {
  if (toolName === 'list_products') {
    const links = await db
      .select()
      .from(merchantPaymentLinks)
      .where(and(eq(merchantPaymentLinks.merchantId, merchantId), eq(merchantPaymentLinks.isActive, true)))
      .orderBy(desc(merchantPaymentLinks.createdAt))
      .limit(20);

    if (!links.length) return { result: 'No products yet.' };

    const list = links.map(l => {
      const price = l.amountTzs ? `${l.amountTzs.toLocaleString()} TZS` : 'open amount';
      const promo = l.discountPct > 0 ? ` (-${l.discountPct}%)` : '';
      const url = `${baseUrl}/m/${handle}?link=${l.id}`;
      return `${l.productName || 'Unnamed'} — ${price}${promo}\n${url}`;
    }).join('\n\n');

    return { result: `${links.length} product(s):\n\n${list}` };
  }

  if (toolName === 'get_sales_summary') {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totals] = await db.select({ total: sum(merchantCollections.amountTzs) }).from(merchantCollections)
      .where(and(eq(merchantCollections.merchantId, merchantId), eq(merchantCollections.collectionStatus, 'minted')));
    const [today] = await db.select({ total: sum(merchantCollections.amountTzs) }).from(merchantCollections)
      .where(and(eq(merchantCollections.merchantId, merchantId), eq(merchantCollections.collectionStatus, 'minted'), gte(merchantCollections.createdAt, startOfDay)));
    const [month] = await db.select({ total: sum(merchantCollections.amountTzs) }).from(merchantCollections)
      .where(and(eq(merchantCollections.merchantId, merchantId), eq(merchantCollections.collectionStatus, 'minted'), gte(merchantCollections.createdAt, startOfMonth)));
    const [activeLinks] = await db.select({ count: count() }).from(merchantPaymentLinks)
      .where(and(eq(merchantPaymentLinks.merchantId, merchantId), eq(merchantPaymentLinks.isActive, true)));
    const recent = await db.select().from(merchantCollections)
      .where(eq(merchantCollections.merchantId, merchantId))
      .orderBy(desc(merchantCollections.createdAt)).limit(3);

    const recentStr = recent.length
      ? recent.map(c => `${c.payerName || 'Someone'} paid ${c.amountTzs.toLocaleString()} TZS`).join(', ')
      : 'no orders yet';

    return {
      result: `All time: ${Number(totals?.total ?? 0).toLocaleString()} TZS. This month: ${Number(month?.total ?? 0).toLocaleString()} TZS. Today: ${Number(today?.total ?? 0).toLocaleString()} TZS. Active products: ${activeLinks?.count ?? 0}. Recent: ${recentStr}.`,
    };
  }

  if (toolName === 'propose_product') {
    const d = toolInput as { productName: string; type: string; amountTzs?: number; description?: string; imageUrl?: string };
    return {
      result: `Drafted "${d.productName}"${d.amountTzs ? ` at ${d.amountTzs.toLocaleString()} TZS` : ''}. Ready for merchant to confirm.`,
      action: { type: 'create_product', data: { ...d } },
    };
  }

  if (toolName === 'propose_promo') {
    const d = toolInput as { productName: string; originalAmountTzs: number; discountPct: number; description?: string; imageUrl?: string };
    const discountedPrice = Math.round(d.originalAmountTzs * (1 - d.discountPct / 100));
    return {
      result: `Promo drafted: "${d.productName}" ${d.discountPct}% off → ${discountedPrice.toLocaleString()} TZS. Ready for merchant to confirm.`,
      action: { type: 'create_promo', data: { ...d, amountTzs: discountedPrice } },
    };
  }

  return { result: 'Unknown tool.' };
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { messages, agentName } = await req.json() as { messages: Anthropic.MessageParam[]; agentName?: string };
  if (!Array.isArray(messages) || !messages.length) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  const [account] = await db
    .select({ handle: merchantAccounts.handle })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, session.merchantId))
    .limit(1);

  const handle = account?.handle ?? 'store';
  const baseUrl = new URL(req.url).origin;
  let pendingAction: ProposedAction | undefined;
  let currentMessages = [...messages];

  try {
    for (let i = 0; i < 5; i++) {
      const response = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: buildSystem(agentName ?? 'Ubongo AI'),
        tools: TOOLS,
        messages: currentMessages,
      });

      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find(b => b.type === 'text');
        return NextResponse.json({
          reply: textBlock?.type === 'text' ? textBlock.text : '',
          action: pendingAction ?? null,
        });
      }

      if (response.stop_reason === 'tool_use') {
        currentMessages = [...currentMessages, { role: 'assistant', content: response.content }];
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const { result, action } = await runTool(session.merchantId, handle, baseUrl, block.name, block.input as Record<string, unknown>);
          if (action) pendingAction = action;
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        }

        currentMessages = [...currentMessages, { role: 'user', content: toolResults }];
        continue;
      }

      break;
    }
  } catch (err) {
    console.error('[merchant/ai/chat] inference failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI inference failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ reply: 'Kuna tatizo kidogo — jaribu tena.', action: null });
}
