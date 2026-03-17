import { eq } from 'drizzle-orm'
import { getDb } from '../apps/web/src/lib/db'
import { wallets, depositRequests, users } from '@ntzs/db'

const walletAddress = '0xDa3db43F3C410Ed57bE22A7D071fe5A54DA05130'

async function main() {
  const { db } = getDb()

  // Find wallet
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.address, walletAddress))
    .limit(1)

  if (!wallet) {
    console.log('❌ No wallet found for', walletAddress)
    return
  }

  console.log('✅ Wallet found:')
  console.log('  ID:', wallet.id)
  console.log('  Address:', wallet.address)
  console.log('  Chain:', wallet.chain)
  console.log('  User ID:', wallet.userId)
  console.log('  Created:', wallet.createdAt)

  // Find user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, wallet.userId))
    .limit(1)

  if (user) {
    console.log('\n👤 User:')
    console.log('  Email:', user.email)
    console.log('  Role:', user.role)
  }

  // Find deposits
  const deposits = await db
    .select()
    .from(depositRequests)
    .where(eq(depositRequests.walletId, wallet.id))
    .orderBy(depositRequests.createdAt)

  console.log('\n💰 Deposits:', deposits.length)
  deposits.forEach((d, i) => {
    console.log(`\n  [${i + 1}] Deposit ${d.id}`)
    console.log('    Amount:', d.amountTzs, 'TZS')
    console.log('    Status:', d.status)
    console.log('    PSP Channel:', d.pspChannel)
    console.log('    PSP Ref:', d.pspReference)
    console.log('    Payment Provider:', d.paymentProvider)
    console.log('    Created:', d.createdAt)
    console.log('    Fiat Confirmed:', d.fiatConfirmedAt)
    console.log('    Minted:', d.mintedAt)
  })
}

main().catch(console.error)
