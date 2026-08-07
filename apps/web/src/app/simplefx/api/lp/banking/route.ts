import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts } from '@ntzs/db';
import { actionDisposition, createApproval } from '@/lib/fx/approvals';

interface BankingProfile {
  bankName?: string;
  /**
   * Shown as "Settlement account reference". The key kept its original name
   * because renaming it would mean migrating jsonb on every existing profile
   * for a cosmetic gain — but it is NOT where a reserve is held: TZS funded
   * through this portal sits in our own trust account, and this is a KYB
   * record, not a routing field. Payouts take a bank and account number
   * chosen at settle-out time.
   */
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

/** PUT /api/lp/banking — save the settlement account and contacts. */
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
    return NextResponse.json({ error: 'Partner bank and settlement account reference are required.' }, { status: 400 });
  }

  const profile: BankingProfile = {
    bankName: body.bankName.trim(),
    trustAccountRef: body.trustAccountRef.trim(),
    swift: body.swift?.trim() || undefined,
    contactName: body.contactName?.trim() || undefined,
    contactEmail: body.contactEmail?.trim() || undefined,
  };

  // Maker-checker + least-privilege: owner/approver save directly, an operator's
  // change is queued for an approver, and any other role (viewer) is denied.
  const disposition = actionDisposition(session.role);
  if (disposition === 'deny') {
    return NextResponse.json({ error: 'Your role does not permit changing banking details.' }, { status: 403 });
  }
  if (disposition === 'queue') {
    await createApproval({ lpId: session.lpId, action: 'set_banking', payload: profile, memberId: session.memberId });
    return NextResponse.json({ ok: true, pending: true });
  }

  await db
    .update(lpAccounts)
    .set({ bankingProfile: profile, updatedAt: new Date() })
    .where(eq(lpAccounts.id, session.lpId));

  return NextResponse.json({ ok: true, banking: profile });
}
