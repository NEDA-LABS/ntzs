import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';
import { clampStep, isAccountType, onboardingState, type AccountType } from '@/lib/fx/onboarding';

/** GET /api/lp/onboarding — current onboarding state for the wizard. */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [lp] = await db
    .select({
      accountType: lpAccounts.accountType,
      onboardingStep: lpAccounts.onboardingStep,
      status: lpAccounts.status,
      kybStatus: lpAccounts.kybStatus,
    })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, session.lpId))
    .limit(1);

  if (!lp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const type = lp.accountType as AccountType;
  return NextResponse.json({
    ...onboardingState(type, lp.onboardingStep),
    status: lp.status,
    kybStatus: lp.kybStatus,
  });
}

/**
 * PATCH /api/lp/onboarding — advance the cursor and/or pick the account type.
 * Body: { step?: number, accountType?: 'standard' | 'bank' }
 *
 * Account type can only be chosen while still onboarding. The step is clamped to
 * the (possibly newly chosen) type's range, so callers can't skip past go-live.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { step?: number; accountType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const [current] = await db
    .select({
      accountType: lpAccounts.accountType,
      status: lpAccounts.status,
      onboardingStep: lpAccounts.onboardingStep,
    })
    .from(lpAccounts)
    .where(eq(lpAccounts.id, session.lpId))
    .limit(1);

  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const set: { updatedAt: Date; accountType?: AccountType; onboardingStep?: number } = {
    updatedAt: new Date(),
  };
  let type = current.accountType as AccountType;

  if (body.accountType !== undefined) {
    if (current.status !== 'onboarding') {
      return NextResponse.json({ error: 'Account type can no longer be changed.' }, { status: 409 });
    }
    if (!isAccountType(body.accountType)) {
      return NextResponse.json({ error: 'accountType must be "standard" or "bank".' }, { status: 400 });
    }
    type = body.accountType;
    set.accountType = type;
  }

  if (body.step !== undefined) {
    if (typeof body.step !== 'number' || !Number.isFinite(body.step)) {
      return NextResponse.json({ error: 'step must be a number.' }, { status: 400 });
    }
    set.onboardingStep = clampStep(type, body.step);
  }

  const [updated] = await db
    .update(lpAccounts)
    .set(set)
    .where(eq(lpAccounts.id, session.lpId))
    .returning({
      accountType: lpAccounts.accountType,
      onboardingStep: lpAccounts.onboardingStep,
      status: lpAccounts.status,
      kybStatus: lpAccounts.kybStatus,
    });

  return NextResponse.json({
    ...onboardingState(updated.accountType as AccountType, updated.onboardingStep),
    status: updated.status,
    kybStatus: updated.kybStatus,
  });
}
