/**
 * Postgres error predicates that survive driver wrapping.
 *
 * ⚠ THE TRAP THIS EXISTS TO AVOID. Drizzle wraps every failed query in a
 * `DrizzleQueryError` whose message is `Failed query: <sql>\nparams: …` and
 * whose `.cause` holds the real driver error. The SQLSTATE we care about
 * (`42703`, `42P01`) is on the CAUSE, not the wrapper, and the wrapper's
 * message never contains "does not exist". So a predicate that inspects only
 * the top-level error silently returns false for exactly the condition it was
 * written to detect.
 *
 * That is not hypothetical: it is why partner API calls returned 500 in the
 * window between deploying the test-mode code and applying its migration
 * (27 Jul 2026) — the deploy-order fallback in lib/waas/auth.ts never latched.
 *
 * Always use these helpers rather than reaching for `err.code` directly.
 */

/** undefined_column */
const UNDEFINED_COLUMN = '42703'
/** undefined_table */
const UNDEFINED_TABLE = '42P01'

/** Walk an error's `cause` chain (depth-capped, cycle-safe). */
function errorChain(err: unknown, maxDepth = 6): unknown[] {
  const chain: unknown[] = []
  const seen = new Set<unknown>()
  let current: unknown = err
  while (current != null && chain.length < maxDepth && !seen.has(current)) {
    seen.add(current)
    chain.push(current)
    current = (current as { cause?: unknown }).cause
  }
  return chain
}

/** Every SQLSTATE found anywhere in the chain. */
export function pgErrorCodes(err: unknown): string[] {
  return errorChain(err)
    .map((e) => (e as { code?: unknown }).code)
    .filter((c): c is string => typeof c === 'string')
}

/**
 * True when the failure is "this column/table isn't there yet" — i.e. code
 * deployed ahead of its migration. Callers use it to degrade to pre-migration
 * behaviour instead of 500-ing.
 *
 * Deliberately narrow: it must never swallow a genuine query bug.
 */
export function isMissingSchemaObject(err: unknown): boolean {
  const codes = pgErrorCodes(err)
  if (codes.includes(UNDEFINED_COLUMN) || codes.includes(UNDEFINED_TABLE)) return true

  // Fallback for drivers that surface no SQLSTATE: check every message in the
  // chain, not just the outermost one.
  return errorChain(err).some((e) => {
    const message = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
    return /(column|relation)\b[^\n]*\bdoes not exist/i.test(message)
  })
}
