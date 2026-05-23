import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/enterprise/db'
import { enterpriseAccounts, enterpriseWithdrawRequests } from '@ntzs/db'
import { eq } from 'drizzle-orm'
import { getSessionFromCookies } from '@/lib/enterprise/auth'

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { amountTzs, payoutMethod = 'mobile', payoutPhone, payoutBankAccount } = body

  if (!amountTzs || amountTzs <= 0) {
    return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 })
  }
  if (payoutMethod === 'mobile' && !payoutPhone) {
    return NextResponse.json({ error: 'Phone number required for mobile payout' }, { status: 400 })
  }
  if (payoutMethod === 'bank' && !payoutBankAccount) {
    return NextResponse.json({ error: 'Bank account required for bank payout' }, { status: 400 })
  }

  const [account] = await db
    .select({ partnerId: enterpriseAccounts.partnerId })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.id, session.enterpriseId))
    .limit(1)

  if (!account?.partnerId) {
    return NextResponse.json({ error: 'Wallet not yet activated. Contact NEDApay.' }, { status: 403 })
  }

  const [request] = await db
    .insert(enterpriseWithdrawRequests)
    .values({
      enterpriseId: session.enterpriseId,
      partnerId: account.partnerId,
      amountTzs: Math.floor(amountTzs),
      payoutMethod,
      payoutPhone: payoutPhone ?? null,
      payoutBankAccount: payoutBankAccount ?? null,
      status: 'pending',
    })
    .returning({ id: enterpriseWithdrawRequests.id })

  return NextResponse.json({ id: request.id, status: 'pending' })
}
