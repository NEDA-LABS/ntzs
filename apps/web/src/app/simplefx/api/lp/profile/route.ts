import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { displayName } = await req.json();
  if (typeof displayName !== 'string' || displayName.length > 80) {
    return NextResponse.json({ error: 'Invalid display name' }, { status: 400 });
  }

  const [updated] = await db
    .update(lpAccounts)
    .set({ displayName: displayName.trim() || null, updatedAt: new Date() })
    .where(eq(lpAccounts.id, session.lpId))
    .returning({ displayName: lpAccounts.displayName });

  return NextResponse.json({ displayName: updated?.displayName });
}
