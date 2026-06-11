/**
 * Server-side idempotency for side-effectful endpoints (withdrawals, etc.).
 *
 * Wrap the side-effecting portion of a route in `withIdempotency`. When the
 * client supplies an `Idempotency-Key`, a claim row is inserted atomically
 * before the work runs:
 *
 *   - first request with a key  → claim succeeds, handler runs, a 2xx response
 *     is stored and returned;
 *   - retry after a 2xx         → the stored response is replayed (the on-chain
 *     action is NOT repeated);
 *   - retry while still running  → 409 (request already in progress);
 *   - non-2xx outcome           → the claim is released so a corrected retry
 *     can proceed.
 *
 * When no key is supplied, the handler runs normally (no dedup) — this keeps
 * existing API clients working while first-party callers opt in.
 */
import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db'

const IN_PROGRESS = { error: 'A request with this Idempotency-Key is already being processed.' }

/** Pull the idempotency key from a request, if present and non-empty. */
export function getIdempotencyKey(request: Request): string | null {
  const key = request.headers.get('Idempotency-Key')?.trim()
  return key ? key : null
}

export async function withIdempotency(
  scope: string,
  key: string | null,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  if (!key) return handler()

  const { sql } = getDb()

  // Atomic claim: only one concurrent request can own a given (scope, key).
  const claimed = await sql<{ id: string }[]>`
    insert into idempotency_keys (scope, idem_key, status)
    values (${scope}, ${key}, 'processing')
    on conflict (scope, idem_key) do nothing
    returning id
  `

  if (!claimed[0]) {
    const [existing] = await sql<{ status: string; response_status: number | null; response_body: unknown }[]>`
      select status, response_status, response_body
      from idempotency_keys
      where scope = ${scope} and idem_key = ${key}
      limit 1
    `
    // Race: the owning request released the claim between our insert and select.
    if (!existing) return handler()
    if (existing.status === 'completed') {
      return NextResponse.json(existing.response_body, { status: existing.response_status ?? 200 })
    }
    return NextResponse.json(IN_PROGRESS, { status: 409 })
  }

  // We own the claim — run the work.
  try {
    const res = await handler()
    if (res.status >= 200 && res.status < 300) {
      const body = await res.clone().json().catch(() => null)
      await sql`
        update idempotency_keys
        set status = 'completed', response_status = ${res.status}, response_body = ${JSON.stringify(body)}::jsonb
        where scope = ${scope} and idem_key = ${key}
      `
    } else {
      // Release so the client can retry after fixing the cause of the failure.
      await sql`delete from idempotency_keys where scope = ${scope} and idem_key = ${key}`
    }
    return res
  } catch (err) {
    await sql`delete from idempotency_keys where scope = ${scope} and idem_key = ${key}`.catch(() => {})
    throw err
  }
}
