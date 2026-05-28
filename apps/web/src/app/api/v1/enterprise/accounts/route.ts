import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, users } from '@ntzs/db'
import { requireServiceKey } from '@/lib/service-auth'

/**
 * POST /api/v1/enterprise/accounts
 *
 * Called by NEDApay when a user submits an Enterprise org application.
 * Creates an enterprise_accounts row with isActive=false and links it to
 * the applicant's nTZS WaaS user ID. The org appears in nTZS backstage
 * for ops review — approval fires a webhook back to NEDApay.
 *
 * Auth: x-service-key header
 * Body: {
 *   linkedAdminUserId: string    — nTZS users.id of the applicant
 *   name: string                 — org / business name
 *   email: string                — org contact email
 *   phone?: string
 *   type: 'capital_lender' | 'disbursement_client'
 * }
 */
export async function POST(req: NextRequest) {
  const authError = requireServiceKey(req)
  if (authError) return authError

  let body: {
    linkedAdminUserId: string
    name: string
    email: string
    phone?: string
    type: 'capital_lender' | 'disbursement_client'
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { linkedAdminUserId, name, email, phone, type } = body

  if (!linkedAdminUserId || !name || !email || !type) {
    return NextResponse.json(
      { error: 'linkedAdminUserId, name, email, and type are required' },
      { status: 400 },
    )
  }

  if (type !== 'capital_lender' && type !== 'disbursement_client') {
    return NextResponse.json(
      { error: 'type must be "capital_lender" or "disbursement_client"' },
      { status: 400 },
    )
  }

  const normalized = email.toLowerCase().trim()

  // Verify the nTZS user exists
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, linkedAdminUserId))
    .limit(1)

  if (!user) {
    return NextResponse.json({ error: 'User not found — provision via WaaS first' }, { status: 404 })
  }

  // Idempotency: one pending application per user
  const [existing] = await db
    .select({ id: enterpriseAccounts.id, isActive: enterpriseAccounts.isActive })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.linkedAdminUserId, linkedAdminUserId))
    .limit(1)

  if (existing) {
    return NextResponse.json({
      enterpriseId: existing.id,
      status: existing.isActive ? 'approved' : 'pending',
      alreadyExists: true,
    })
  }

  const [org] = await db
    .insert(enterpriseAccounts)
    .values({
      name: name.trim(),
      email: normalized,
      phone: phone?.trim() || null,
      type,
      linkedAdminUserId,
      isActive: false,
    })
    .returning({ id: enterpriseAccounts.id })

  return NextResponse.json(
    { enterpriseId: org.id, status: 'pending' },
    { status: 201 },
  )
}
