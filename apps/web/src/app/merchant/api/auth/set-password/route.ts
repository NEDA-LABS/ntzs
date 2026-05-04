import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/merchant/db';
import { merchantAccounts } from '@ntzs/db';
import { getSessionFromCookies, hashPassword, verifyPassword } from '@/lib/merchant/auth';

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromCookies();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { password, currentPassword } = await req.json();

    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const [merchant] = await db
      .select({ id: merchantAccounts.id, passwordHash: merchantAccounts.passwordHash })
      .from(merchantAccounts)
      .where(eq(merchantAccounts.id, session.merchantId))
      .limit(1);

    if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (merchant.passwordHash) {
      if (!currentPassword) {
        return NextResponse.json({ error: 'Current password required' }, { status: 400 });
      }
      const valid = await verifyPassword(currentPassword, merchant.passwordHash);
      if (!valid) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
      }
    }

    const hash = await hashPassword(password);
    await db
      .update(merchantAccounts)
      .set({ passwordHash: hash })
      .where(eq(merchantAccounts.id, merchant.id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[merchant/set-password]', err);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }
}
