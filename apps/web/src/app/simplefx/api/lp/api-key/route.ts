import { NextResponse } from 'next/server'
import { getSessionFromCookies, generateMmApiKey, hashMmApiKey } from '@/lib/fx/auth'
import { db } from '@/lib/fx/db'
import { lpAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'

/**
 * POST /simplefx/api/lp/api-key
 *
 * Generates (or rotates) the MM API key for the authenticated LP.
 * Returns the raw key once — it is never stored in plaintext.
 * Subsequent calls rotate the key and invalidate the previous one.
 */
export async function POST() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rawKey = generateMmApiKey()
  const keyHash = hashMmApiKey(rawKey)

  await db
    .update(lpAccounts)
    .set({ apiKeyHash: keyHash, updatedAt: new Date() })
    .where(eq(lpAccounts.id, session.lpId))

  return NextResponse.json({ apiKey: rawKey })
}

/**
 * DELETE /simplefx/api/lp/api-key
 *
 * Revokes the MM API key for the authenticated LP.
 */
export async function DELETE() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await db
    .update(lpAccounts)
    .set({ apiKeyHash: null, updatedAt: new Date() })
    .where(eq(lpAccounts.id, session.lpId))

  return NextResponse.json({ revoked: true })
}
