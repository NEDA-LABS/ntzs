#!/usr/bin/env tsx
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../apps/web/src/lib/db'
import { partners, partnerUsers, users, wallets } from '@ntzs/db'

async function main() {
  const { db } = getDb()

  // Find Betua
  const [betua] = await db
    .select({ id: partners.id, name: partners.name })
    .from(partners)
    .where(eq(partners.name, 'Betua'))
    .limit(1)

  if (!betua) {
    console.log('❌ Betua partner not found')
    return
  }

  console.log(`🏢 Partner: ${betua.name}\n`)

  // Get all Betua users
  const betuaUserRows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(partnerUsers)
    .innerJoin(users, eq(partnerUsers.userId, users.id))
    .where(eq(partnerUsers.partnerId, betua.id))

  const userIds = betuaUserRows.map((u) => u.userId)
  console.log(`👥 Total users: ${userIds.length}\n`)

  // Get all wallets for these users
  const allWallets = await db
    .select({
      id: wallets.id,
      userId: wallets.userId,
      address: wallets.address,
      chain: wallets.chain,
      createdAt: wallets.createdAt,
    })
    .from(wallets)
    .where(sql`${wallets.userId} IN ${userIds}`)
    .orderBy(wallets.address, wallets.createdAt)

  console.log(`🔐 Total wallet records: ${allWallets.length}\n`)

  // Find duplicates by address
  const addressMap = new Map<string, typeof allWallets>()
  for (const wallet of allWallets) {
    if (!addressMap.has(wallet.address)) {
      addressMap.set(wallet.address, [])
    }
    addressMap.get(wallet.address)!.push(wallet)
  }

  const duplicates = Array.from(addressMap.entries())
    .filter(([_, wallets]) => wallets.length > 1)
    .sort((a, b) => b[1].length - a[1].length)

  console.log(`🔄 Duplicate addresses: ${duplicates.length}\n`)

  if (duplicates.length === 0) {
    console.log('✅ No duplicate wallet addresses found')
    return
  }

  console.log('Duplicate wallet details:\n')
  for (const [address, walletList] of duplicates) {
    console.log(`📍 Address: ${address}`)
    console.log(`   Count: ${walletList.length} wallet records`)
    for (const wallet of walletList) {
      const user = betuaUserRows.find((u) => u.userId === wallet.userId)
      console.log(`   - Wallet ID: ${wallet.id}`)
      console.log(`     User: ${user?.email || wallet.userId}`)
      console.log(`     Chain: ${wallet.chain}`)
      console.log(`     Created: ${wallet.createdAt}`)
    }
    console.log('')
  }

  // Summary
  const totalDuplicateRecords = duplicates.reduce((sum, [_, wallets]) => sum + wallets.length, 0)
  const uniqueAddresses = duplicates.length
  const extraRecords = totalDuplicateRecords - uniqueAddresses

  console.log('\n📊 Summary:')
  console.log(`   Unique addresses with duplicates: ${uniqueAddresses}`)
  console.log(`   Total duplicate records: ${totalDuplicateRecords}`)
  console.log(`   Extra records to clean up: ${extraRecords}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
