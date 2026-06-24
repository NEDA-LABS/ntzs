import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';

import { requireAnyRole } from '@/lib/auth/rbac';
import { getDb } from '@/lib/db';
import { lpKybDocuments } from '@ntzs/db';

/**
 * GET /api/backstage/simplefx/kyb-file?lpId=…&docType=…
 *
 * Streams a KYB document stored in Postgres back to a super-admin reviewer. The
 * file is never exposed via a public URL — access requires the backstage role.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAnyRole(['super_admin']);
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const lpId = req.nextUrl.searchParams.get('lpId');
  const docType = req.nextUrl.searchParams.get('docType');
  if (!lpId || !docType) {
    return NextResponse.json({ error: 'lpId and docType are required' }, { status: 400 });
  }

  const { db } = getDb();
  const [doc] = await db
    .select({
      fileData: lpKybDocuments.fileData,
      contentType: lpKybDocuments.contentType,
      fileName: lpKybDocuments.fileName,
    })
    .from(lpKybDocuments)
    .where(and(eq(lpKybDocuments.lpId, lpId), eq(lpKybDocuments.docType, docType)))
    .limit(1);

  if (!doc || !doc.fileData) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const bytes = new Uint8Array(Buffer.from(doc.fileData, 'base64'));
  const safeName = (doc.fileName || `${docType}`).replace(/["\r\n]/g, '');
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': doc.contentType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
