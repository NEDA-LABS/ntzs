import { NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { partners } from '@ntzs/db'
import { asc } from 'drizzle-orm'
import { requireAnyRole } from '@/lib/auth/rbac'

export async function GET() {
  try { await requireAnyRole(['super_admin', 'platform_compliance']) } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rows = await db
    .select({ id: partners.id, name: partners.name })
    .from(partners)
    .orderBy(asc(partners.name))
    .limit(500)

  return NextResponse.json({ partners: rows })
}
