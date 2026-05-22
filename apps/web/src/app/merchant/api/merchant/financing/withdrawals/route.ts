import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { db } from '@/lib/merchant/db'
import { merchantAccounts } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/merchant/auth'

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [merchant] = await db
    .select({ id: merchantAccounts.id })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.id, session.merchantId))
    .limit(1)

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { sql: rawSql } = getDb()
  const rows = await rawSql<{
    id: string
    amount_tzs: number
    status: string
    recipient_phone: string
    payout_status: string | null
    payout_reference: string | null
    created_at: string
  }[]>`
    select id, amount_tzs, status, recipient_phone, payout_status, payout_reference, created_at
    from burn_requests
    where reason = 'merchant_withdrawal'
      and metadata->>'merchantId' = ${merchant.id}
    order by created_at desc
    limit 20
  `

  return NextResponse.json({ withdrawals: rows })
}
