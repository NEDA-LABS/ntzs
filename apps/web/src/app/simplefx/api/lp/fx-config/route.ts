import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts } from '@ntzs/db';
import { needsApproval, createApproval } from '@/lib/fx/approvals';

interface Limits {
  maxInventoryNtzs?: number;
  maxInventoryUsd?: number;
  perTxnCapUsd?: number;
}

/** GET /api/lp/fx-config — current spread + exposure limits. */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [lp] = await db
    .select({ bidBps: lpAccounts.bidBps, askBps: lpAccounts.askBps, limits: lpAccounts.limits })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, session.lpId))
    .limit(1);

  return NextResponse.json({
    bidBps: lp?.bidBps ?? 120,
    askBps: lp?.askBps ?? 150,
    limits: (lp?.limits as Limits | null) ?? null,
  });
}

/** PUT /api/lp/fx-config — set spread (bps) and optional exposure limits. */
export async function PUT(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { bidBps?: number; askBps?: number; limits?: Limits };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { bidBps, askBps } = body;
  if (
    typeof bidBps !== 'number' || typeof askBps !== 'number' ||
    bidBps < 10 || bidBps > 500 || askBps < 10 || askBps > 500
  ) {
    return NextResponse.json({ error: 'Bid and ask must each be 10–500 bps.' }, { status: 400 });
  }

  // Normalise limits: keep only finite, non-negative numbers.
  const clean: Limits = {};
  const src = body.limits ?? {};
  for (const key of ['maxInventoryNtzs', 'maxInventoryUsd', 'perTxnCapUsd'] as const) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) clean[key] = v;
  }
  const limits = Object.keys(clean).length ? clean : null;

  // Maker-checker: an operator's change is queued for an approver.
  if (needsApproval(session.role)) {
    await createApproval({ lpId: session.lpId, action: 'set_fx', payload: { bidBps, askBps, limits }, memberId: session.memberId });
    return NextResponse.json({ ok: true, pending: true, message: 'Submitted to an approver.' });
  }

  await db
    .update(lpAccounts)
    .set({ bidBps, askBps, limits, updatedAt: new Date() })
    .where(eq(lpAccounts.id, session.lpId));

  return NextResponse.json({ ok: true, bidBps, askBps, limits });
}
