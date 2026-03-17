import { eq, and, like } from 'drizzle-orm'
import { getDb } from '../apps/web/src/lib/db'
import { depositRequests, wallets } from '@ntzs/db'
import { executeMint } from '../apps/web/src/lib/minting/executeMint'

const snippeRef = 'SN17737263358455250'

async function main() {
  const { db } = getDb()

  console.log('🔍 Searching for deposit with Snippe ref:', snippeRef)

  const [deposit] = await db
    .select({
      id: depositRequests.id,
      userId: depositRequests.userId,
      walletId: depositRequests.walletId,
      amountTzs: depositRequests.amountTzs,
      status: depositRequests.status,
      pspReference: depositRequests.pspReference,
      walletAddress: wallets.address,
    })
    .from(depositRequests)
    .leftJoin(wallets, eq(depositRequests.walletId, wallets.id))
    .where(like(depositRequests.pspReference, `%${snippeRef}%`))
    .limit(1)

  if (!deposit) {
    console.log('❌ No deposit found with reference', snippeRef)
    return
  }

  console.log('\n✅ Found deposit:')
  console.log('  ID:', deposit.id)
  console.log('  Wallet:', deposit.walletAddress)
  console.log('  Amount:', deposit.amountTzs, 'TZS')
  console.log('  Current Status:', deposit.status)

  if (deposit.status !== 'submitted') {
    console.log('\n⚠️  Deposit is not in "submitted" status, skipping approval')
    if (deposit.status === 'mint_pending' || deposit.status === 'mint_processing') {
      console.log('💡 Triggering mint anyway...')
      const result = await executeMint(deposit.id)
      console.log('Mint result:', result)
    }
    return
  }

  console.log('\n📝 Updating status to mint_pending...')
  await db
    .update(depositRequests)
    .set({
      status: 'mint_pending',
      fiatConfirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(depositRequests.id, deposit.id))

  console.log('✅ Status updated to mint_pending')

  console.log('\n🔨 Triggering mint...')
  const result = await executeMint(deposit.id)
  
  console.log('\n✅ Mint completed:')
  console.log('  Status:', result.status)
  if (result.status === 'minted') {
    console.log('  Tx Hash:', result.txHash)
    console.log('  View on BaseScan:', `https://basescan.org/tx/${result.txHash}`)
  } else if (result.status === 'failed') {
    console.log('  Error:', result.error)
  } else if (result.status === 'skipped') {
    console.log('  Reason:', result.reason)
  }
}

main().catch(console.error)
