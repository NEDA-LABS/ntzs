import { NextRequest } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { lpFills, lpAccounts, partners } from '@ntzs/db'

const TOKEN_SYMBOLS: Record<string, string> = {
  '0xf476ba983de2f1ad532380630e2cf1d1b8b10688': 'nTZS',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
  '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': 'USDT',
}

function tokenSymbol(addr: string | null) {
  if (!addr) return ''
  return TOKEN_SYMBOLS[addr.toLowerCase()] ?? addr
}

function csvEscape(val: string | null | undefined) {
  if (val == null) return ''
  const s = String(val)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

export async function GET(_req: NextRequest) {
  await requireAnyRole(['super_admin'])
  const { db } = getDb()

  const fills = await db
    .select({
      id: lpFills.id,
      createdAt: lpFills.createdAt,
      source: lpFills.source,
      lpEmail: lpAccounts.email,
      lpDisplayName: lpAccounts.displayName,
      lpId: lpFills.lpId,
      userAddress: lpFills.userAddress,
      fromToken: lpFills.fromToken,
      toToken: lpFills.toToken,
      amountIn: lpFills.amountIn,
      amountOut: lpFills.amountOut,
      spreadEarned: lpFills.spreadEarned,
      inTxHash: lpFills.inTxHash,
      outTxHash: lpFills.outTxHash,
      chain: lpFills.chain,
      partnerName: partners.name,
    })
    .from(lpFills)
    .leftJoin(lpAccounts, eq(lpFills.lpId, lpAccounts.id))
    .leftJoin(partners, eq(lpFills.partnerId, partners.id))
    .orderBy(desc(lpFills.createdAt))

  const headers = [
    'Timestamp (EAT)',
    'Source',
    'Partner',
    'LP Email',
    'LP Name',
    'LP ID',
    'User Wallet',
    'Chain',
    'From Token',
    'To Token',
    'Amount In',
    'Amount Out',
    'Spread Earned',
    'In Tx Hash',
    'Out Tx Hash',
  ]

  const rows = fills.map((f) => {
    const ts = f.createdAt
      ? new Date(f.createdAt).toLocaleString('en-TZ', { timeZone: 'Africa/Dar_es_Salaam', hour12: false })
      : ''
    return [
      ts,
      f.source ?? 'unknown',
      f.partnerName ?? '',
      f.lpEmail ?? '',
      f.lpDisplayName ?? '',
      f.lpId,
      f.userAddress ?? '',
      f.chain ?? 'base',
      tokenSymbol(f.fromToken),
      tokenSymbol(f.toToken),
      f.amountIn?.toString() ?? '',
      f.amountOut?.toString() ?? '',
      f.spreadEarned?.toString() ?? '',
      f.inTxHash ?? '',
      f.outTxHash ?? '',
    ].map(csvEscape).join(',')
  })

  const csv = [headers.join(','), ...rows].join('\r\n')
  const filename = `ntzs-swap-fills-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
