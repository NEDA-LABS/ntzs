import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/fx/auth';

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
