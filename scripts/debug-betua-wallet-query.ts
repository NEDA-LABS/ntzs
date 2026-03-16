#!/usr/bin/env tsx
import { eq, and } from 'drizzle-orm'
import { getDb } from '../apps/web/src/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '../apps/web/src/lib/env'
import { partners, partnerUsers, users, wallets } from '@ntzs/db'

async function fetchERC20BalancesBatch(
  rpcUrl: string,
  contractAddress: string,
  addresses: string[]
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {}
  const batch = addresses.map((addr, i) => ({
    jsonrpc: '2.0',
    method: 'eth_call',
    params: [
      { to: contractAddress, data: '0x70a08231' + addr.toLowerCase().replace('0x', '').padStart(64, '0') },
      'latest',
    ],
    id: i,
  }))
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(15000),
    })
    const results = await res.json() as Array<{ id: number; result?: string; error?: unknown }>
    const out: Record<string, number> = {}
    for (const item of results) {
      const addr = addresses[item.id]
      if (!addr) continue
      if (item.error || !item.result || item.result === '0x') {
        out[addr] = 0
      } else {
        out[addr] = Number(BigInt(item.result) / BigInt(10) ** BigInt(18))
      }
    }
    return out
  } catch {
    return {}
  }
}

async function main() {
  const { db } = getDb()
  const rpcUrl = BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/TTD2FFw8V5a368PK_9V5p'
  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE

  console.log('🔍 Debugging Betua wallet query (mimicking dashboard API)...\n')

  const partnerId = 'bcfd9bec-bea7-441a-8c53-33426c4bd31f' // Betua

  // Step 1: Get all users for this partner (exactly as dashboard does)
  const partnerUserRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(partnerUsers)
    .innerJoin(users, eq(partnerUsers.userId, users.id))
    .where(eq(partnerUsers.partnerId, partnerId))
    .limit(100)

  const userIds = partnerUserRows.map((u) => u.id)
  console.log(`👥 Users from partner_users: ${userIds.length}`)

  // Step 2: Get wallets for all partner users (exactly as dashboard does)
  const userWallets: Record<string, { id: string; address: string }> = {}
  if (userIds.length > 0) {
    const walletResults = await Promise.all(
      userIds.map((uid) =>
        db
          .select({ id: wallets.id, address: wallets.address })
          .from(wallets)
          .where(and(eq(wallets.userId, uid), eq(wallets.chain, 'base')))
          .limit(1)
          .then(([w]) => ({ uid, w }))
      )
    )
    for (const { uid, w } of walletResults) {
      if (w) userWallets[uid] = w
    }
  }

  console.log(`🔐 Wallets found: ${Object.keys(userWallets).length}`)

  // Step 3: Collect addresses (exactly as dashboard does)
  const userAddrs: { uid: string; addr: string }[] = userIds
    .map((uid) => ({ uid, addr: userWallets[uid]?.address ?? '' }))
    .filter((x) => x.addr && !x.addr.startsWith('0x_pending_'))

  console.log(`📍 Addresses to query: ${userAddrs.length}\n`)

  // Check for duplicate addresses in the list
  const addressCounts = new Map<string, number>()
  for (const { addr } of userAddrs) {
    addressCounts.set(addr, (addressCounts.get(addr) || 0) + 1)
  }

  const duplicateAddrs = Array.from(addressCounts.entries())
    .filter(([_, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])

  if (duplicateAddrs.length > 0) {
    console.log(`⚠️  DUPLICATE ADDRESSES IN QUERY LIST:`)
    for (const [addr, count] of duplicateAddrs) {
      console.log(`   ${addr}: appears ${count} times`)
      const usersWithAddr = userAddrs.filter((x) => x.addr === addr)
      for (const { uid } of usersWithAddr) {
        const user = partnerUserRows.find((u) => u.id === uid)
        console.log(`      - User: ${user?.email || uid}`)
      }
    }
    console.log('')
  } else {
    console.log('✅ No duplicate addresses in query list\n')
  }

  // Step 4: Fetch balances
  const allAddrs = userAddrs.map((x) => x.addr)
  const balanceMap = await fetchERC20BalancesBatch(rpcUrl, contractAddress, allAddrs)

  // Step 5: Sum balances (exactly as dashboard does)
  let totalBalanceTzs = 0
  for (const { uid, addr } of userAddrs) {
    const tzs = balanceMap[addr] ?? 0
    totalBalanceTzs += tzs
  }

  console.log(`💵 Total Balance (dashboard calculation): ${totalBalanceTzs.toLocaleString()} TZS`)

  // Step 6: Calculate UNIQUE address total
  const uniqueAddrs = Array.from(new Set(allAddrs))
  let uniqueTotal = 0
  for (const addr of uniqueAddrs) {
    uniqueTotal += balanceMap[addr] ?? 0
  }

  console.log(`💵 Total Balance (unique addresses): ${uniqueTotal.toLocaleString()} TZS`)
  console.log(`📊 Difference: ${(totalBalanceTzs - uniqueTotal).toLocaleString()} TZS\n`)

  if (totalBalanceTzs !== uniqueTotal) {
    console.log('⚠️  ISSUE FOUND: Dashboard is summing duplicate addresses!')
    console.log('   The same wallet address is being counted multiple times.')
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
