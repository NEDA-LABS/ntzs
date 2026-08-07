import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { isAddress } from 'ethers'

import { getSessionFromCookies } from '@/lib/fx/auth'
import { db } from '@/lib/fx/db'
import { lpPayoutDestinations } from '@ntzs/db'
import { BANK_FI_CODES } from '@/lib/psp/selcom'

const CHAINS = ['base', 'bnb'] as const

/**
 * Saved payout destinations.
 *
 * A viewer may read the list — seeing where funds go is part of reading the
 * account — but writing one is a maker action: a destination saved today is a
 * destination someone sends to later, so it gets the same role gate as moving
 * funds. It does not go through maker-checker, because saving a row moves
 * nothing on its own and the withdrawal it is later used for is gated anyway.
 */
const canWrite = (role: string | undefined) =>
  !role || role === 'owner' || role === 'approver' || role === 'operator'

/** Postgres 23505 for a named constraint, looked for down the `cause` chain. */
function isUniqueViolation(e: unknown, constraint: string): boolean {
  for (let err: unknown = e, hops = 0; err && hops < 5; hops++) {
    const c = err as { code?: string; constraint_name?: string; cause?: unknown }
    if (c.code === '23505' && c.constraint_name === constraint) return true
    err = c.cause
  }
  return false
}

/** GET /api/lp/destinations — list saved destinations, newest first. */
export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const destinations = await db
    .select({
      id: lpPayoutDestinations.id,
      kind: lpPayoutDestinations.kind,
      label: lpPayoutDestinations.label,
      chain: lpPayoutDestinations.chain,
      address: lpPayoutDestinations.address,
      bankCode: lpPayoutDestinations.bankCode,
      accountNumber: lpPayoutDestinations.accountNumber,
      createdAt: lpPayoutDestinations.createdAt,
    })
    .from(lpPayoutDestinations)
    .where(eq(lpPayoutDestinations.lpId, session.lpId))

  return NextResponse.json({
    destinations,
    you: { canWrite: canWrite(session.role) },
  })
}

/**
 * POST /api/lp/destinations — save one.
 * Body: { kind: 'crypto', label, chain, address } | { kind: 'bank', label, bankCode, accountNumber }
 */
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canWrite(session.role)) {
    return NextResponse.json({ error: 'Your role does not permit saving destinations.' }, { status: 403 })
  }

  let body: {
    kind?: string
    label?: string
    chain?: string
    address?: string
    bankCode?: string
    accountNumber?: string
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const label = body.label?.trim()
  if (!label) return NextResponse.json({ error: 'A name is required.' }, { status: 400 })
  if (label.length > 60) return NextResponse.json({ error: 'Name must be 60 characters or fewer.' }, { status: 400 })

  let values: typeof lpPayoutDestinations.$inferInsert

  if (body.kind === 'crypto') {
    const address = body.address?.trim()
    const chain = body.chain?.trim().toLowerCase()
    // Saving an unchecked address just moves the typo one step earlier — the
    // whole point is that this value is trusted on every later withdrawal.
    if (!address || !isAddress(address)) {
      return NextResponse.json({ error: 'That is not a valid address.' }, { status: 400 })
    }
    if (!chain || !CHAINS.includes(chain as (typeof CHAINS)[number])) {
      return NextResponse.json({ error: `Chain must be one of: ${CHAINS.join(', ')}.` }, { status: 400 })
    }
    values = { lpId: session.lpId, kind: 'crypto', label, chain, address, createdByMemberId: session.memberId ?? null }
  } else if (body.kind === 'bank') {
    const bankCode = body.bankCode?.trim()
    const accountNumber = body.accountNumber?.replace(/\s/g, '')
    // Validated against the same registry the payout uses. A destination saved
    // once and trusted forever has to be payable at the moment it is saved,
    // otherwise the check has simply been deferred to the withdrawal that fails.
    if (!bankCode || !(bankCode in BANK_FI_CODES)) {
      return NextResponse.json({ error: 'That is not a bank we can pay out to.' }, { status: 400 })
    }
    if (!accountNumber || accountNumber.replace(/\D/g, '').length < 5) {
      return NextResponse.json({ error: 'That account number looks too short.' }, { status: 400 })
    }
    values = { lpId: session.lpId, kind: 'bank', label, bankCode, accountNumber, createdByMemberId: session.memberId ?? null }
  } else {
    return NextResponse.json({ error: 'kind must be crypto or bank.' }, { status: 400 })
  }

  try {
    const [destination] = await db.insert(lpPayoutDestinations).values(values).returning({
      id: lpPayoutDestinations.id,
      kind: lpPayoutDestinations.kind,
      label: lpPayoutDestinations.label,
      chain: lpPayoutDestinations.chain,
      address: lpPayoutDestinations.address,
      bankCode: lpPayoutDestinations.bankCode,
      accountNumber: lpPayoutDestinations.accountNumber,
      createdAt: lpPayoutDestinations.createdAt,
    })
    return NextResponse.json({ ok: true, destination })
  } catch (e) {
    // Unique on (lpId, lower(label)) — two entries an operator can't tell
    // apart are more dangerous than making them pick a new name.
    //
    // The driver's error is wrapped by the query builder, so the constraint
    // lives on `cause`, not in the top-level message; matching on the message
    // alone silently turns a name clash into a 500.
    if (isUniqueViolation(e, 'lp_payout_destinations_label_uq')) {
      return NextResponse.json({ error: 'You already have a destination with that name.' }, { status: 409 })
    }
    throw e
  }
}

/** DELETE /api/lp/destinations — remove one. Body: { destinationId }. */
export async function DELETE(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canWrite(session.role)) {
    return NextResponse.json({ error: 'Your role does not permit removing destinations.' }, { status: 403 })
  }

  let body: { destinationId?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.destinationId) return NextResponse.json({ error: 'destinationId is required.' }, { status: 400 })

  const deleted = await db
    .delete(lpPayoutDestinations)
    .where(and(eq(lpPayoutDestinations.id, body.destinationId), eq(lpPayoutDestinations.lpId, session.lpId)))
    .returning({ id: lpPayoutDestinations.id })

  if (deleted.length === 0) return NextResponse.json({ error: 'Destination not found.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
