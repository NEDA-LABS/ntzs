import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts } from '@ntzs/db';
import { needsApproval, createApproval } from '@/lib/fx/approvals';

interface BankingProfile {
  bankName?: string;
  trustAccountRef?: string;
  swift?: string;
  contactName?: string;
  contactEmail?: string;
}

/** GET /api/lp/banking — the LP's saved banking/reserve profile. */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [lp] = await db
    .select({ bankingProfile: lpAccounts.bankingProfile })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, session.lpId))
    .limit(1);

  return NextResponse.json({ banking: (lp?.bankingProfile as BankingProfile | null) ?? null });
}

/** PUT /api/lp/banking — save the trust-account / settlement details. */
export async function PUT(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: BankingProfile;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.bankName?.trim() || !body.trustAccountRef?.trim()) {
    return NextResponse.json({ error: 'Partner bank and trust account reference are required.' }, { status: 400 });
  }

  const profile: BankingProfile = {
    bankName: body.bankName.trim(),
    trustAccountRef: body.trustAccountRef.trim(),
    swift: body.swift?.trim() || undefined,
    contactName: body.contactName?.trim() || undefined,
    contactEmail: body.contactEmail?.trim() || undefined,
  };

  // Maker-checker: an operator's change is queued for an approver.
  if (needsApproval(session.role)) {
    await createApproval({ lpId: session.lpId, action: 'set_banking', payload: profile, memberId: session.memberId });
    return NextResponse.json({ ok: true, pending: true });
  }

  await db
    .update(lpAccounts)
    .set({ bankingProfile: profile, updatedAt: new Date() })
    .where(eq(lpAccounts.id, session.lpId));

  return NextResponse.json({ ok: true, banking: profile });
}
