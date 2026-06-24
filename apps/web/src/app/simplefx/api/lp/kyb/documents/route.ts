import { NextRequest, NextResponse } from 'next/server';
import { eq, and, ne } from 'drizzle-orm';

import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts, lpKybDocuments } from '@ntzs/db';
import { KYB_DOC_KEYS } from '@/lib/fx/onboarding';

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
// Vercel caps a serverless request body at ~4.5 MB, so keep files comfortably under.
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

/** GET /api/lp/kyb/documents — the LP's uploaded KYB docs + overall KYB status. */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [docs, [lp]] = await Promise.all([
    // Metadata only — never load the (potentially large) file bytes into the list.
    db
      .select({
        docType: lpKybDocuments.docType,
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
 *
 * Files are stored as base64 directly in Postgres (no external object store) and
 * served only through authenticated routes — KYC documents never get a public URL.
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
    return NextResponse.json({ error: 'File exceeds the 4 MB limit' }, { status: 400 });
  }

  let fileData: string;
  try {
    fileData = Buffer.from(await file.arrayBuffer()).toString('base64');
  } catch (err) {
    console.error('[lp/kyb] read failed:', err);
    return NextResponse.json({ error: 'Could not read the file. Please try again.' }, { status: 400 });
  }

  try {
    await db
      .insert(lpKybDocuments)
      .values({ lpId: session.lpId, docType, fileData, contentType: file.type, fileName: file.name, status: 'submitted' })
      .onConflictDoUpdate({
        target: [lpKybDocuments.lpId, lpKybDocuments.docType],
        set: { fileData, contentType: file.type, fileName: file.name, fileUrl: null, status: 'submitted', updatedAt: new Date() },
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
    return NextResponse.json({ error: 'Could not save the upload. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, docType });
}
