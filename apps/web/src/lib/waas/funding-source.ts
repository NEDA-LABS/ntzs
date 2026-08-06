import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { hasCapability } from '@/lib/platform/capabilities'
import { partnerSubWallets, partners, users, wallets } from '@ntzs/db'

/**
 * Where a disbursement's money comes from.
 *
 * Until now every money route resolved funds exactly one way: the wallet
 * belonging to `userId`. Agent-float ("SmartWakala") partners need a second
 * shape — a partner SUB-WALLET that holds one agent's unified nTZS float and
 * can pay any mobile wallet, till or biller.
 *
 * Both shapes resolve through this one function so a funding source can never
 * be accepted by an execute route that its quote route would have refused.
 *
 * ── The compliance contract ──────────────────────────────────────────────
 * `subjectKey` is the participant the BoT sandbox caps are counted against.
 * Sub-wallets sit under a partner treasury, so per-USER caps do not apply to
 * them by default — which would make them a route around Parameters #4/#5.
 * Returning an explicit subject is what keeps each agent float capped exactly
 * as a user is, and makes a second sub-wallet another participant rather than
 * fresh headroom. Callers MUST pass this to the period-limit check.
 */

export type FundingSource =
  | {
      kind: 'user'
      /** Burn source and balance address. */
      address: string
      /** Cap subject — see the compliance contract above. */
      subject: { kind: 'user'; id: string }
      userId: string
      walletId: string
      externalId: string
    }
  | {
      kind: 'sub_wallet'
      address: string
      subject: { kind: 'sub_wallet'; id: string }
      subWalletId: string
      label: string
      /** Record-keeping FKs only — burn_requests.user_id/wallet_id are NOT NULL. */
      userId: string
      walletId: string
    }

export type FundingResult = { source: FundingSource } | { error: NextResponse }

/** Exactly 'true' → partners may fund disbursements from a sub-wallet. */
export function wakalaFloatEnabled(): boolean {
  return process.env.WAKALA_FLOAT_ENABLED === 'true'
}

/**
 * The synthetic treasury user + wallet a partner already gets for
 * `collectToTreasury` deposits. Agent-float burns reuse it purely to satisfy
 * the NOT NULL record-keeping FKs on burn_requests — the REAL source of funds
 * is `burnFromAddress`, and the real cap subject is `subWalletId`.
 */
async function resolvePartnerTreasuryRecord(
  partnerId: string
): Promise<{ userId: string; walletId: string } | null> {
  const { db } = getDb()

  const [partnerRow] = await db
    .select({ name: partners.name, email: partners.email, treasuryWalletAddress: partners.treasuryWalletAddress })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)
  if (!partnerRow?.treasuryWalletAddress) return null

  const neonAuthUserId = `treasury_${partnerId}`
  let [user] = await db.select({ id: users.id }).from(users).where(eq(users.neonAuthUserId, neonAuthUserId)).limit(1)
  if (!user) {
    const [created] = await db
      .insert(users)
      .values({
        neonAuthUserId,
        email: partnerRow.email ?? `treasury+${partnerId}@waas.internal`,
        name: `${partnerRow.name ?? 'Partner'} Treasury`,
        role: 'end_user',
      })
      .onConflictDoNothing()
      .returning({ id: users.id })
    if (created) user = created
    else {
      const [refetch] = await db.select({ id: users.id }).from(users).where(eq(users.neonAuthUserId, neonAuthUserId)).limit(1)
      if (!refetch) return null
      user = refetch
    }
  }

  let [wallet] = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.userId, user.id), eq(wallets.chain, 'base')))
    .limit(1)
  if (!wallet) {
    const [created] = await db
      .insert(wallets)
      .values({ userId: user.id, chain: 'base', address: partnerRow.treasuryWalletAddress, provider: 'external' })
      .onConflictDoNothing()
      .returning({ id: wallets.id })
    if (created) wallet = created
    else {
      const [refetch] = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(and(eq(wallets.userId, user.id), eq(wallets.chain, 'base')))
        .limit(1)
      if (!refetch) return null
      wallet = refetch
    }
  }

  return { userId: user.id, walletId: wallet.id }
}

/**
 * Resolve the funding source for a disbursement request.
 *
 * `subWalletId` present → agent float (requires the `wakala` capability, the
 * WAKALA_FLOAT_ENABLED flag, and ownership of the sub-wallet).
 * Otherwise → the user's own wallet, exactly as before.
 */
export async function resolveFundingSource(
  partner: { id: string },
  body: { userId?: string; subWalletId?: string }
): Promise<FundingResult> {
  const { db } = getDb()

  if (body.subWalletId) {
    if (!wakalaFloatEnabled()) {
      return {
        error: NextResponse.json(
          {
            error: 'wakala_float_disabled',
            message: 'Sub-wallet funded disbursements are not enabled on this environment yet.',
          },
          { status: 503 }
        ),
      }
    }

    const [partnerRow] = await db
      .select({ capabilities: partners.capabilities })
      .from(partners)
      .where(eq(partners.id, partner.id))
      .limit(1)
    if (!hasCapability(partnerRow?.capabilities ?? null, 'wakala')) {
      return {
        error: NextResponse.json(
          {
            error: 'capability_required',
            message:
              "Funding a disbursement from a sub-wallet requires the 'wakala' capability, which isn't enabled for your account.",
          },
          { status: 403 }
        ),
      }
    }

    if (!/^[0-9a-f-]{36}$/i.test(body.subWalletId)) {
      return { error: NextResponse.json({ error: 'Sub-wallet not found' }, { status: 404 }) }
    }

    // Ownership: a partner may only spend from its OWN sub-wallets.
    const [sub] = await db
      .select({ id: partnerSubWallets.id, address: partnerSubWallets.address, label: partnerSubWallets.label })
      .from(partnerSubWallets)
      .where(and(eq(partnerSubWallets.id, body.subWalletId), eq(partnerSubWallets.partnerId, partner.id)))
      .limit(1)
    if (!sub) {
      return { error: NextResponse.json({ error: 'Sub-wallet not found' }, { status: 404 }) }
    }

    const record = await resolvePartnerTreasuryRecord(partner.id)
    if (!record) {
      return {
        error: NextResponse.json(
          {
            error: 'treasury_not_provisioned',
            message: 'Provision your partner treasury before funding disbursements from a sub-wallet.',
          },
          { status: 400 }
        ),
      }
    }

    return {
      source: {
        kind: 'sub_wallet',
        address: sub.address,
        subject: { kind: 'sub_wallet', id: sub.id },
        subWalletId: sub.id,
        label: sub.label,
        userId: record.userId,
        walletId: record.walletId,
      },
    }
  }

  // ── Default: the user's own wallet (unchanged behaviour) ──────────────────
  if (!body.userId) {
    // Naming both fields with no further help actively misdirects: a partner
    // reads "or subWalletId", tries it, and gets wakala_float_disabled — a
    // dead end for anyone not on the agent-float product. So sub-wallets are
    // mentioned only where they are actually usable, and the message says what
    // the id IS and where it comes from. The externalId note pre-empts the very
    // next mistake, which returns a different error ("User not found") and
    // reads like the user is missing rather than the wrong id being sent.
    return {
      error: NextResponse.json(
        {
          error: 'funding_source_required',
          message: wakalaFloatEnabled()
            ? 'userId is required — the user whose nTZS balance pays for this. Use the id returned by POST /api/v1/users, not your own externalId. Agent-float partners may send subWalletId instead.'
            : 'userId is required — the user whose nTZS balance pays for this. Use the id returned by POST /api/v1/users, not your own externalId.',
        },
        { status: 400 }
      ),
    }
  }

  const { partnerUsers } = await import('@ntzs/db')
  const [mapping] = await db
    .select({ externalId: partnerUsers.externalId })
    .from(partnerUsers)
    .where(and(eq(partnerUsers.partnerId, partner.id), eq(partnerUsers.userId, body.userId)))
    .limit(1)
  if (!mapping) {
    // Almost always the partner's own externalId sent where our user id belongs
    // — the two are both opaque strings, so the mistake is invisible until here.
    return {
      error: NextResponse.json(
        {
          error: 'User not found',
          code: 'user_not_found',
          message:
            'No user with this id belongs to your account. Check you are sending the nTZS user id returned by POST /api/v1/users rather than your own externalId.',
        },
        { status: 404 }
      ),
    }
  }

  const [wallet] = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, body.userId), eq(wallets.chain, 'base')))
    .limit(1)
  if (!wallet || wallet.address.startsWith('0x_pending_')) {
    return { error: NextResponse.json({ error: 'User wallet is not provisioned yet' }, { status: 400 }) }
  }

  return {
    source: {
      kind: 'user',
      address: wallet.address,
      subject: { kind: 'user', id: body.userId },
      userId: body.userId,
      walletId: wallet.id,
      externalId: mapping.externalId,
    },
  }
}

/** Stable string for binding a funding source into a signed quote token. */
export function fundingSourceKey(source: FundingSource): string {
  return `${source.subject.kind}:${source.subject.id}`
}
