import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { db } from '@/lib/db';
import { lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { isActive } = await req.json();

  const [updated] = await db
    .update(lpAccounts)
    .set({
      isActive: Boolean(isActive),
      onboardingStep: isActive ? 4 : 3,
      updatedAt: new Date(),
    })
    .where(eq(lpAccounts.id, session.lpId))
    .returning();

  return NextResponse.json({ lp: updated });
}
