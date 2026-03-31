import { NextResponse } from 'next/server';
import { db } from '@/lib/fx/db';
import { lpFxConfig } from '@ntzs/db';
import { eq } from 'drizzle-orm';

export async function GET() {
  const [config] = await db.select().from(lpFxConfig).where(eq(lpFxConfig.id, 1)).limit(1);
  return NextResponse.json({ midRateTZS: config?.midRateTZS ?? 3750 });
}
