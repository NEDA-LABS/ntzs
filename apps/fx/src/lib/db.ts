import { createDbClient } from '@ntzs/db';
import type { DbClient } from '@ntzs/db';

let _client: ReturnType<typeof createDbClient> | null = null;

function getClient(): DbClient {
  if (!_client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _client = createDbClient(url);
  }
  return _client;
}

export const db = new Proxy({} as DbClient['db'], {
  get(_target, prop) {
    return (getClient().db as unknown as Record<string | symbol, unknown>)[prop];
  },
});
