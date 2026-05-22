import { NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [account] = await db
    .select({
      id: enterpriseAccounts.id,
      name: enterpriseAccounts.name,
      email: enterpriseAccounts.email,
      type: enterpriseAccounts.type,
      partnerId: enterpriseAccounts.partnerId,
      hasPassword: enterpriseAccounts.passwordHash,
    })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, session.enterpriseId))
    .limit(1)

  if (!account?.hasPassword === undefined) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    id: account.id,
    name: account.name,
    email: account.email,
    type: account.type,
    partnerId: account.partnerId,
    hasPassword: !!account.hasPassword,
  })
}
