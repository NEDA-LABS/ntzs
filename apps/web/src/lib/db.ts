import { createDbClient, type DbClient } from '@ntzs/db'

let cached: DbClient | undefined

export function getDb() {
  if (cached) return cached

  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  cached = createDbClient(databaseUrl)
  return cached
}
