/**
 * Pure name/ID matching rules for Tier-1 identity binding.
 *
 * Tanzanian SIMs are registered with NIDA + fingerprints at the telco, so the
 * name (or ID number) registered behind a mobile-money MSISDN is
 * biometrically-bound evidence. We compare it against the NIDA holder's name
 * from Selcom Identity. Kept free of I/O so every rule is unit-tested.
 */

/** Digits-only ID comparison (NIDA numbers may arrive dashed or spaced). */
export function sameIdNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = (a ?? '').replace(/\D/g, '')
  const db = (b ?? '').replace(/\D/g, '')
  return da.length >= 9 && da === db
}

function normalizeToken(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')
}

export function tokenizeName(name: string): string[] {
  return (name ?? '')
    .split(/[\s,.-]+/)
    .map(normalizeToken)
    .filter((t) => t.length >= 2)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return Math.max(m, n)
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = curr
  }
  return prev[n]
}

/** Two name tokens "agree": exact, prefix (≥4 chars), or a single typo (≥5 chars). */
function tokensAgree(a: string, b: string): boolean {
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (shorter.length >= 4 && longer.startsWith(shorter)) return true
  if (shorter.length >= 5 && levenshtein(a, b) <= 1) return true
  return false
}

export interface NameMatchResult {
  /** Both sides produced at least one usable token. */
  comparable: boolean
  matchedTokens: number
  /** ≥2 name components agree — first + last name in the common case. */
  matched: boolean
}

/**
 * Greedy 1:1 token pairing between two full names, order-independent.
 * matched requires at least two agreeing components, so a merely shared first
 * name ("Mohamed …" vs "Mohamed …") never binds an identity.
 */
export function matchNames(nidaName: string | null | undefined, registeredName: string | null | undefined): NameMatchResult {
  const a = tokenizeName(nidaName ?? '')
  const b = tokenizeName(registeredName ?? '')
  if (a.length === 0 || b.length === 0) return { comparable: false, matchedTokens: 0, matched: false }

  const remaining = [...b]
  let matchedTokens = 0
  for (const token of a) {
    const idx = remaining.findIndex((r) => tokensAgree(token, r))
    if (idx !== -1) {
      matchedTokens += 1
      remaining.splice(idx, 1)
    }
  }
  return { comparable: true, matchedTokens, matched: matchedTokens >= 2 }
}
