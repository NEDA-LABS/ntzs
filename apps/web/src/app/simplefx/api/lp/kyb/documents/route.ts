import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { eq, and, ne } from 'drizzle-orm';

import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts, lpKybDocuments } from '@ntzs/db';
import { KYB_DOC_KEYS } from '@/lib/fx/onboarding';

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** GET /api/lp/kyb/documents — the LP's uploaded KYB docs + overall KYB status. */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [docs, [lp]] = await Promise.all([
    db
      .select({
        docType: lpKybDocuments.docType,
        fileUrl: lpKybDocuments.fileUrl,
        fileName: lpKybDocuments.fileName,
        status: lpKybDocuments.status,
        updatedAt: lpKybDocuments.updatedAt,
      })
      .from(lpKybDocuments)
      .where(eq(lpKybDocuments.lpId, session.lpId)),
    db.select({ kybStatus: lpAccounts.kybStatus, kybReviewNote: lpAccounts.kybReviewNote }).from(lpAccounts).where(eq(lpAccounts.id, session.lpId)).limit(1),
  ]);

  return NextResponse.json({ kybStatus: lp?.kybStatus ?? 'not_started', reviewNote: lp?.kybReviewNote ?? null, documents: docs });
}

/**
 * POST /api/lp/kyb/documents — upload one KYB document (multipart: file, docType).
 * Stores in blob and upserts the row; flips the account's kybStatus to 'submitted'
 * on the first upload. Mirrors the partner KYB upload pattern.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const docType = formData.get('docType') as string | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!docType || !KYB_DOC_KEYS.includes(docType)) {
    return NextResponse.json({ error: 'docType must be one of: ' + KYB_DOC_KEYS.join(', ') }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'File must be PDF, JPEG, PNG, or WebP' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 });
  }

  const ext = file.name.split('.').pop() ?? 'bin';
  const pathname = `kyb/lp/${session.lpId}/${docType}.${ext}`;

  // Store the file. Wrapped so a storage failure (e.g. BLOB_READ_WRITE_TOKEN not
  // configured) returns a clear JSON error instead of an unhandled 500 — which the
  // client otherwise surfaces as a generic "Network error".
  let blobUrl: string;
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: 'Document storage is not configured (BLOB_READ_WRITE_TOKEN missing). Connect a Vercel Blob store.' },
        { status: 503 },
      );
    }
    const blob = await put(pathname, file, { access: 'public', addRandomSuffix: false, allowOverwrite: true });
    blobUrl = blob.url;
  } catch (err) {
    console.error('[lp/kyb] blob upload failed:', err);
    return NextResponse.json(
      { error: 'Storage upload failed: ' + (err instanceof Error ? err.message : 'unknown error') },
      { status: 502 },
    );
  }

  try {
    await db
      .insert(lpKybDocuments)
      .values({ lpId: session.lpId, docType, fileUrl: blobUrl, fileName: file.name, status: 'submitted' })
      .onConflictDoUpdate({
        target: [lpKybDocuments.lpId, lpKybDocuments.docType],
        set: { fileUrl: blobUrl, fileName: file.name, status: 'submitted', updatedAt: new Date() },
      });

    // Mark the account's KYB as in review on (re)submission. Moves not_started →
    // submitted and, after ops asked for more info, rejected → submitted; never
    // overrides an existing approval.
    await db
      .update(lpAccounts)
      .set({ kybStatus: 'submitted', kybReviewNote: null, updatedAt: new Date() })
      .where(and(eq(lpAccounts.id, session.lpId), ne(lpAccounts.kybStatus, 'approved')));
  } catch (err) {
    console.error('[lp/kyb] db write failed:', err);
    return NextResponse.json({ error: 'Could not record the upload. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, docType, fileUrl: blobUrl });
}
