import { NextResponse } from 'next/server'
import { neonAuth } from '@neondatabase/neon-js/auth/next'

import { getDb } from '@/lib/db'

export async function GET() {
  const { user } = await neonAuth()

  const databaseUrl = process.env.DATABASE_URL
  const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null

  const { sql } = getDb()

  const dbNameRows = await sql<{ current_database: string }[]>`
    select current_database() as current_database
  `

  const userCountRows = await sql<{ count: string }[]>`
    select count(*)::text as count from public.users
  `

  return NextResponse.json({
    authenticated: Boolean(user),
    neonAuthUserId: user?.id ?? null,
    databaseHost: parsedDatabaseUrl?.hostname ?? null,
    databaseNameFromUrl: parsedDatabaseUrl?.pathname?.replace(/^\//, '') ?? null,
    currentDatabase: dbNameRows[0]?.current_database ?? null,
    publicUsersCount: userCountRows[0]?.count ?? null,
  })
}
