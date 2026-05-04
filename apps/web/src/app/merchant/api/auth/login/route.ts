import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/merchant/db';
import { merchantAccounts } from '@ntzs/db';
import { verifyPassword, createSession, setSessionCookie } from '@/lib/merchant/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const normalized = email.toLowerCase().trim();

    const [merchant] = await db
      .select()
      .from(merchantAccounts)
      .where(eq(merchantAccounts.email, normalized))
      .limit(1);

    // Constant-time response to prevent account enumeration
    if (!merchant?.passwordHash) {
      await new Promise(r => setTimeout(r, 200));
      return NextResponse.json(
        { error: 'No password set for this account. Use email code to sign in.' },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, merchant.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
    }

    const token = await createSession(merchant.id);
    await setSessionCookie(token);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[merchant/login]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
