import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import * as schema from './schema'

export function createDbClient(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    // Neon requires SSL in most configurations; DATABASE_URL usually contains sslmode=require.
    // If it doesn’t, you can add ssl: 'require' here later.
    max: 5,
  })

  return {
    db: drizzle(sql, { schema }),
    sql,
  }
}

export type DbClient = ReturnType<typeof createDbClient>
