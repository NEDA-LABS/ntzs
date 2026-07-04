import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/merchant/db';
import { merchantPaymentLinks } from '@ntzs/db';

// Only non-scriptable raster image types may be served inline from our origin.
// Notably excludes image/svg+xml and text/html — both can execute script, which
// (combined with echoing the merchant-supplied MIME) was a stored-XSS vector.
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const SAFE_IMAGE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Disposition': 'inline',
  'Content-Security-Policy': "default-src 'none'",
  'Cache-Control': 'public, max-age=31536000, immutable',
} as const;

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

  // base64 data URI — decode and stream back, but ONLY for an allow-listed
  // raster image type, and NEVER echo the caller-supplied MIME. Add nosniff +
  // a locked-down CSP so a browser can't be tricked into executing the bytes.
  if (src.startsWith('data:')) {
    const commaIdx = src.indexOf(',');
    if (commaIdx === -1) return new NextResponse('Bad image', { status: 400 });
    const header = src.slice(5, commaIdx);            // e.g. "image/jpeg;base64"
    const mimeType = header.split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      return new NextResponse('Unsupported image type', { status: 415 });
    }
    const buffer = Buffer.from(src.slice(commaIdx + 1), 'base64');
    return new NextResponse(buffer, {
      headers: {
        ...SAFE_IMAGE_HEADERS,
        'Content-Type': mimeType,
        'Content-Length': String(buffer.byteLength),
      },
    });
  }

  // External URL — only redirect to an https URL (blocks javascript:/data:/http
  // downgrade). When ALLOWED_IMAGE_HOSTS is set, restrict to those hosts so this
  // route can't be abused as an open redirect on our own domain.
  let target: URL;
  try {
    target = new URL(src);
  } catch {
    return new NextResponse('Bad image URL', { status: 400 });
  }
  if (target.protocol !== 'https:') {
    return new NextResponse('Bad image URL', { status: 400 });
  }
  const allowedHosts = (process.env.ALLOWED_IMAGE_HOSTS ?? '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowedHosts.length > 0 && !allowedHosts.includes(target.hostname.toLowerCase())) {
    console.warn('[merchant/image] blocked redirect to non-allowlisted host', { host: target.hostname });
    return new NextResponse('Image host not allowed', { status: 400 });
  }

  return NextResponse.redirect(target.toString(), { status: 302 });
}
