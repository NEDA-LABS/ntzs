import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bidBps, askBps } = await req.json();

  if (
    typeof bidBps !== 'number' || typeof askBps !== 'number' ||
    bidBps < 10 || bidBps > 500 || askBps < 10 || askBps > 500
  ) {
    return NextResponse.json({ error: 'Invalid spread values (10–500 bps each)' }, { status: 400 });
  }

  const [updated] = await db
    .update(lpAccounts)
    .set({ bidBps, askBps, onboardingStep: 3, updatedAt: new Date() })
    .where(eq(lpAccounts.id, session.lpId))
    .returning();

  return NextResponse.json({ lp: updated });
}
