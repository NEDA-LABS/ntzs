import { NextRequest, NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { partners, partnerInvoices } from '@ntzs/db'
import { verifySessionToken } from '@/lib/waas/auth'
import { PLATFORM_TREASURY_ADDRESS } from '@/lib/env'

export async function GET(request: NextRequest) {
  const cookieToken = request.cookies.get('partner_session')?.value
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = cookieToken || bearerToken

  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const partnerId = verifySessionToken(token)
  if (!partnerId) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })

  const { db } = getDb()

  const [partner] = await db
    .select({
      id: partners.id,
      name: partners.name,
      joiningFeeUsd: partners.joiningFeeUsd,
      joiningFeePaidAt: partners.joiningFeePaidAt,
      pilotEndsAt: partners.pilotEndsAt,
      walletAllocation: partners.walletAllocation,
      contractEndAt: partners.contractEndAt,
      monthlyFeeUsd: partners.monthlyFeeUsd,
      contractSignedAt: partners.contractSignedAt,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1)

  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

  const invoices = await db
    .select()
    .from(partnerInvoices)
    .where(eq(partnerInvoices.partnerId, partnerId))
    .orderBy(desc(partnerInvoices.createdAt))

  const now = new Date()
  const pilotActive = partner.pilotEndsAt ? new Date(partner.pilotEndsAt) > now : false
  const joiningFeePaid = partner.joiningFeePaidAt != null

  return NextResponse.json({
    billing: {
      joiningFeeUsd: parseFloat(String(partner.joiningFeeUsd ?? '50000')),
      joiningFeePaid,
      joiningFeePaidAt: partner.joiningFeePaidAt ?? null,
      pilotEndsAt: partner.pilotEndsAt ?? null,
      pilotActive,
      walletAllocation: partner.walletAllocation ?? 20,
      contractEndAt: partner.contractEndAt ?? null,
      monthlyFeeUsd: parseFloat(String(partner.monthlyFeeUsd ?? '2000')),
      contractSignedAt: partner.contractSignedAt ?? null,
    },
    invoices,
    paymentInstructions: {
      usdc: {
        network: 'Base',
        tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        recipientAddress: PLATFORM_TREASURY_ADDRESS || null,
      },
      bankTransfer: {
        bankName: process.env.WAAS_BANK_NAME || null,
        accountNumber: process.env.WAAS_BANK_ACCOUNT || null,
        reference: `NTZS-WAAS-${partner.id.slice(0, 8).toUpperCase()}`,
      },
    },
  })
}
