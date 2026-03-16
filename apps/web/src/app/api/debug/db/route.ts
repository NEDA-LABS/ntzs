import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// Removed neonAuth() call - API has changed
export async function GET() {
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
    authenticated: false, // TODO: Update when Neon Auth API is fixed
    neonAuthUserId: null,
    databaseHost: parsedDatabaseUrl?.hostname ?? null,
    databaseNameFromUrl: parsedDatabaseUrl?.pathname?.replace(/^\//, '') ?? null,
    currentDatabase: dbNameRows[0]?.current_database ?? null,
    publicUsersCount: userCountRows[0]?.count ?? null,
  })
}
