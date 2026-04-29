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
  const amountTzs = type === 'fixed' ? Number(body.amountTzs) : null;
  const description = typeof body.description === 'string' ? body.description.trim() || null : null;
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || null : null;

  if (type === 'fixed' && (!amountTzs || amountTzs < 100)) {
    return NextResponse.json({ error: 'Fixed links require amountTzs ≥ 100' }, { status: 400 });
  }

  const [link] = await db
    .insert(merchantPaymentLinks)
    .values({
      merchantId: session.merchantId,
      type,
      amountTzs,
      description,
      slug,
    })
    .returning();

  return NextResponse.json({ link }, { status: 201 });
}
