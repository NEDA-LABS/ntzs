import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/merchant/db';
import { merchantPaymentLinks } from '@ntzs/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [link] = await db
    .select({ imageUrl: merchantPaymentLinks.imageUrl })
    .from(merchantPaymentLinks)
    .where(eq(merchantPaymentLinks.id, id))
    .limit(1);

  if (!link?.imageUrl) {
    return new NextResponse('Not found', { status: 404 });
  }

  const src = link.imageUrl;

  // base64 data URI — decode and stream back with proper content-type
  if (src.startsWith('data:')) {
    const commaIdx = src.indexOf(',');
    const header = src.slice(5, commaIdx);          // e.g. "image/jpeg;base64"
    const mimeType = header.split(';')[0];           // e.g. "image/jpeg"
    const base64Data = src.slice(commaIdx + 1);
    const buffer = Buffer.from(base64Data, 'base64');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(buffer.byteLength),
      },
    });
  }

  // External URL — redirect (WhatsApp follows redirects for OG images)
  return NextResponse.redirect(src, { status: 302 });
}
