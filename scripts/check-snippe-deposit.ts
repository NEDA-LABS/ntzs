import { eq, or, like } from 'drizzle-orm'
import { getDb } from '../apps/web/src/lib/db'
import { depositRequests, wallets, users } from '@ntzs/db'

const snippeRef = 'SN17737263358455250'

async function main() {
  const { db } = getDb()

  console.log('Searching for Snippe reference:', snippeRef)

  const deposits = await db
    .select({
      id: depositRequests.id,
      userId: depositRequests.userId,
      walletId: depositRequests.walletId,
      amountTzs: depositRequests.amountTzs,
      status: depositRequests.status,
      pspReference: depositRequests.pspReference,
      pspChannel: depositRequests.pspChannel,
      createdAt: depositRequests.createdAt,
      fiatConfirmedAt: depositRequests.fiatConfirmedAt,
      mintedAt: depositRequests.mintedAt,
      walletAddress: wallets.address,
      userEmail: users.email,
    })
    .from(depositRequests)
    .leftJoin(wallets, eq(depositRequests.walletId, wallets.id))
    .leftJoin(users, eq(depositRequests.userId, users.id))
    .where(like(depositRequests.pspReference, `%${snippeRef}%`))
    .limit(5)

  if (deposits.length === 0) {
    console.log('❌ No deposit found with reference', snippeRef)
    return
  }

  const d = deposits[0]
  console.log('\n✅ Found deposit:')
  console.log('  ID:', d.id)
  console.log('  User:', d.userEmail)
  console.log('  Wallet:', d.walletAddress)
  console.log('  Amount:', d.amountTzs, 'TZS')
  console.log('  Status:', d.status)
  console.log('  PSP Ref:', d.pspReference)
  console.log('  Created:', d.createdAt)
  console.log('  Fiat Confirmed:', d.fiatConfirmedAt || 'NOT CONFIRMED')
  console.log('  Minted:', d.mintedAt || 'NOT MINTED')

  if (d.walletAddress) {
    console.log('\n🔍 Checking on-chain balance...')
    const { ethers } = await import('ethers')
    const provider = new ethers.JsonRpcProvider('https://mainnet.base.org')
    const contract = new ethers.Contract(
      '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688',
      ['function balanceOf(address) view returns (uint256)'],
      provider
    )
    const balance = await contract.balanceOf(d.walletAddress)
    console.log('  On-chain balance:', ethers.formatEther(balance), 'nTZS')
  }
}

main().catch(console.error)
