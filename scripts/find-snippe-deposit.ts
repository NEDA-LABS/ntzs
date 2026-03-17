import { eq, or, like } from 'drizzle-orm'
import { getDb } from '../apps/web/src/lib/db'
import { depositRequests, wallets, users } from '@ntzs/db'

const snippeRef = 'SN17734778060800686'
const walletAddress = '0xDa3db43F3C410Ed57bE22A7D071fe5A54DA05130'

async function main() {
  const { db } = getDb()

  console.log('Searching for Snippe reference:', snippeRef)
  console.log('Wallet address:', walletAddress)

  // Search by pspReference
  const deposits = await db
    .select({
      id: depositRequests.id,
      userId: depositRequests.userId,
      walletId: depositRequests.walletId,
      amountTzs: depositRequests.amountTzs,
      status: depositRequests.status,
      pspReference: depositRequests.pspReference,
      pspChannel: depositRequests.pspChannel,
      paymentProvider: depositRequests.paymentProvider,
      createdAt: depositRequests.createdAt,
      fiatConfirmedAt: depositRequests.fiatConfirmedAt,
      mintedAt: depositRequests.mintedAt,
      walletAddress: wallets.address,
      userEmail: users.email,
    })
    .from(depositRequests)
    .leftJoin(wallets, eq(depositRequests.walletId, wallets.id))
    .leftJoin(users, eq(depositRequests.userId, users.id))
    .where(
      or(
        eq(depositRequests.pspReference, snippeRef),
        like(depositRequests.pspReference, `%${snippeRef}%`)
      )
    )
    .limit(10)

  console.log('\n📋 Found', deposits.length, 'deposit(s) with this reference:\n')

  deposits.forEach((d, i) => {
    console.log(`[${i + 1}] Deposit ${d.id}`)
    console.log('  User:', d.userEmail)
    console.log('  Wallet:', d.walletAddress)
    console.log('  Amount:', d.amountTzs, 'TZS')
    console.log('  Status:', d.status)
    console.log('  PSP Ref:', d.pspReference)
    console.log('  PSP Channel:', d.pspChannel)
    console.log('  Provider:', d.paymentProvider)
    console.log('  Created:', d.createdAt)
    console.log('  Fiat Confirmed:', d.fiatConfirmedAt || 'NOT CONFIRMED')
    console.log('  Minted:', d.mintedAt || 'NOT MINTED')
    console.log()
  })

  if (deposits.length === 0) {
    console.log('❌ No deposits found with this Snippe reference')
    console.log('\nSearching all deposits for wallet', walletAddress, '...\n')

    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.address, walletAddress))
      .limit(1)

    if (!wallet) {
      console.log('❌ Wallet not found in database')
      return
    }

    const walletDeposits = await db
      .select()
      .from(depositRequests)
      .where(eq(depositRequests.walletId, wallet.id))
      .orderBy(depositRequests.createdAt)

    console.log('Found', walletDeposits.length, 'total deposits for this wallet:\n')
    walletDeposits.forEach((d, i) => {
      console.log(`[${i + 1}] ${d.amountTzs} TZS - ${d.status} - ${d.pspReference || 'no ref'} - ${d.createdAt}`)
    })
  }
}

main().catch(console.error)
