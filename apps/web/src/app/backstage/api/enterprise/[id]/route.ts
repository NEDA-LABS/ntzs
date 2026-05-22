import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { requireAnyRole } from '@/lib/auth/rbac'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAnyRole(['super_admin', 'platform_compliance']) } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const [account] = await db
    .select()
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, id))
    .limit(1)

  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ account })
}
