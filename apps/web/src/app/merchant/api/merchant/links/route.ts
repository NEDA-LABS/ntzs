import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/merchant/auth';
import { db } from '@/lib/merchant/db';
import { merchantPaymentLinks } from '@ntzs/db';
import { and, desc, eq } from 'drizzle-orm';

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const links = await db
    .select()
    .from(merchantPaymentLinks)
    .where(eq(merchantPaymentLinks.merchantId, session.merchantId))
    .orderBy(desc(merchantPaymentLinks.createdAt));

  return NextResponse.json({ links });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const type = body.type === 'fixed' ? 'fixed' : 'open';

  const productName = typeof body.productName === 'string' ? body.productName.trim() || null : null;
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() || null : null;
  const description = typeof body.description === 'string' ? body.description.trim() || null : null;
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || null : null;

  const discountPct = Math.min(100, Math.max(0, Number(body.discountPct) || 0));
  const originalAmountTzs = body.originalAmountTzs ? Number(body.originalAmountTzs) : null;

  // amountTzs = discounted price if discount applied, otherwise the entered price
  let amountTzs: number | null = null;
  if (type === 'fixed') {
    if (originalAmountTzs && discountPct > 0) {
      amountTzs = Math.round(originalAmountTzs * (1 - discountPct / 100));
    } else {
      amountTzs = Number(body.amountTzs) || null;
    }
    if (!amountTzs || amountTzs < 100) {
      return NextResponse.json({ error: 'Fixed links require amount ≥ 100 TZS' }, { status: 400 });
    }
  }

  const [link] = await db
    .insert(merchantPaymentLinks)
    .values({
      merchantId: session.merchantId,
      type,
      productName,
      imageUrl,
      amountTzs,
      originalAmountTzs: type === 'fixed' && discountPct > 0 ? originalAmountTzs : null,
      discountPct,
      description,
      slug,
    })
    .returning();

  return NextResponse.json({ link }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await db
    .delete(merchantPaymentLinks)
    .where(and(eq(merchantPaymentLinks.id, id), eq(merchantPaymentLinks.merchantId, session.merchantId)));

  return NextResponse.json({ ok: true });
}
