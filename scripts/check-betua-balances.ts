#!/usr/bin/env tsx
import { eq } from 'drizzle-orm'
import { ethers } from 'ethers'
import { getDb } from '../apps/web/src/lib/db'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '../apps/web/src/lib/env'
import { partners, partnerUsers, partnerSubWallets, users, wallets } from '@ntzs/db'

const ERC20_ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]

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
  const rpcUrl = BASE_RPC_URL
  const contractAddress = NTZS_CONTRACT_ADDRESS_BASE

  if (!rpcUrl || !contractAddress) {
    throw new Error('BASE_RPC_URL or NTZS_CONTRACT_ADDRESS_BASE not set')
  }

  console.log('Checking nTZS on-chain data...\n')
  console.log(`RPC: ${rpcUrl}`)
  console.log(`Contract: ${contractAddress}\n`)

  // Get total supply
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const token = new ethers.Contract(contractAddress, ERC20_ABI, provider)
  const totalSupplyWei: bigint = await token.totalSupply()
  const totalSupplyTzs = Number(totalSupplyWei / BigInt(10) ** BigInt(18))

  console.log(`📊 Total Supply (on-chain): ${totalSupplyTzs.toLocaleString()} TZS\n`)

  // Find Betua partner
  const [betua] = await db
    .select({
      id: partners.id,
      name: partners.name,
      treasuryWalletAddress: partners.treasuryWalletAddress,
    })
    .from(partners)
    .where(eq(partners.name, 'Betua'))
    .limit(1)

  if (!betua) {
    console.log('❌ Betua partner not found')
    return
  }

  console.log(`🏢 Partner: ${betua.name} (${betua.id})`)
  console.log(`💰 Treasury: ${betua.treasuryWalletAddress || 'none'}\n`)

  // Get all Betua users
  const betuaUserRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(partnerUsers)
    .innerJoin(users, eq(partnerUsers.userId, users.id))
    .where(eq(partnerUsers.partnerId, betua.id))
    .limit(200)

  const userIds = betuaUserRows.map((u) => u.id)
  console.log(`👥 Users: ${userIds.length}`)

  // Get wallets
  const userWallets: Record<string, { id: string; address: string }> = {}
  if (userIds.length > 0) {
    const walletResults = await Promise.all(
      userIds.map((uid) =>
        db
          .select({ id: wallets.id, address: wallets.address })
          .from(wallets)
          .where(eq(wallets.userId, uid))
          .limit(1)
          .then(([w]) => ({ uid, w }))
      )
    )
    for (const { uid, w } of walletResults) {
      if (w) userWallets[uid] = w
    }
  }

  // Get sub-wallets
  const subWalletRows = await db
    .select({
      id: partnerSubWallets.id,
      label: partnerSubWallets.label,
      address: partnerSubWallets.address,
    })
    .from(partnerSubWallets)
    .where(eq(partnerSubWallets.partnerId, betua.id))

  console.log(`🔐 Sub-wallets: ${subWalletRows.length}\n`)

  // Collect all addresses
  const treasuryAddr = betua.treasuryWalletAddress
  const userAddrs = userIds
    .map((uid) => userWallets[uid]?.address ?? '')
    .filter((addr) => addr && !addr.startsWith('0x_pending_'))

  const allAddrs = [
    ...(treasuryAddr ? [treasuryAddr] : []),
    ...userAddrs,
    ...subWalletRows.map((sw) => sw.address),
  ]

  console.log(`📍 Total addresses to check: ${allAddrs.length}`)
  console.log(`   - Treasury: ${treasuryAddr ? 1 : 0}`)
  console.log(`   - User wallets: ${userAddrs.length}`)
  console.log(`   - Sub-wallets: ${subWalletRows.length}\n`)

  // Fetch balances
  const balanceMap = await fetchERC20BalancesBatch(rpcUrl, contractAddress, allAddrs)

  const treasuryBalance = treasuryAddr ? (balanceMap[treasuryAddr] ?? 0) : 0
  const userBalances = userAddrs.map((addr) => balanceMap[addr] ?? 0)
  const subWalletBalances = subWalletRows.map((sw) => balanceMap[sw.address] ?? 0)

  const totalUserBalance = userBalances.reduce((sum, b) => sum + b, 0)
  const totalSubWalletBalance = subWalletBalances.reduce((sum, b) => sum + b, 0)
  const totalBetuaBalance = treasuryBalance + totalUserBalance + totalSubWalletBalance

  console.log('💵 Betua Balances:')
  console.log(`   - Treasury: ${treasuryBalance.toLocaleString()} TZS`)
  console.log(`   - Users: ${totalUserBalance.toLocaleString()} TZS`)
  console.log(`   - Sub-wallets: ${totalSubWalletBalance.toLocaleString()} TZS`)
  console.log(`   - TOTAL: ${totalBetuaBalance.toLocaleString()} TZS\n`)

  console.log('📈 Comparison:')
  console.log(`   Total Supply: ${totalSupplyTzs.toLocaleString()} TZS`)
  console.log(`   Betua Total:  ${totalBetuaBalance.toLocaleString()} TZS`)
  const diff = totalBetuaBalance - totalSupplyTzs
  console.log(`   Difference:   ${diff >= 0 ? '+' : ''}${diff.toLocaleString()} TZS`)

  if (diff > 0) {
    console.log(`\n⚠️  WARNING: Betua balances exceed total supply by ${diff.toLocaleString()} TZS`)
    console.log('   This suggests phantom balances or incorrect data.')
  } else if (diff < 0) {
    console.log(`\n✅ OK: Betua holds ${Math.abs(diff).toLocaleString()} TZS less than total supply`)
    console.log('   Other partners/wallets hold the remaining balance.')
  } else {
    console.log('\n✅ OK: Betua balances match total supply exactly')
  }

  // Show top 10 balances
  const allBalances = [
    ...(treasuryAddr ? [{ type: 'Treasury', addr: treasuryAddr, balance: treasuryBalance }] : []),
    ...userAddrs.map((addr, i) => ({ type: 'User', addr, balance: userBalances[i] ?? 0 })),
    ...subWalletRows.map((sw, i) => ({ type: 'Sub-wallet', addr: sw.address, balance: subWalletBalances[i] ?? 0 })),
  ].sort((a, b) => b.balance - a.balance)

  console.log('\n🔝 Top 10 Balances:')
  for (const item of allBalances.slice(0, 10)) {
    if (item.balance > 0) {
      console.log(`   ${item.type.padEnd(12)} ${item.addr.slice(0, 10)}... ${item.balance.toLocaleString()} TZS`)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
