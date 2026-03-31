import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { step } = await req.json();
  if (typeof step !== 'number') return NextResponse.json({ error: 'Invalid' }, { status: 400 });

  const [updated] = await db
    .update(lpAccounts)
    .set({ onboardingStep: step, updatedAt: new Date() })
    .where(eq(lpAccounts.id, session.lpId))
    .returning({ onboardingStep: lpAccounts.onboardingStep });

  return NextResponse.json({ onboardingStep: updated?.onboardingStep });
}
