import { createDbClient } from '@ntzs/db'

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  return createDbClient(databaseUrl)
}
