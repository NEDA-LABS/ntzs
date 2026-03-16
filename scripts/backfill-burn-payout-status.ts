#!/usr/bin/env tsx
import { eq, and } from 'drizzle-orm'
import { getDb } from '../apps/web/src/lib/db'
import { burnRequests } from '@ntzs/db'

async function main() {
  const { db } = getDb()

  console.log('Finding burns with status=burned but payoutStatus=pending...')

  const burns = await db
    .select({
      id: burnRequests.id,
      status: burnRequests.status,
      payoutStatus: burnRequests.payoutStatus,
      payoutReference: burnRequests.payoutReference,
      amountTzs: burnRequests.amountTzs,
      createdAt: burnRequests.createdAt,
    })
    .from(burnRequests)
    .where(
      and(
        eq(burnRequests.status, 'burned'),
        eq(burnRequests.payoutStatus, 'pending')
      )
    )

  console.log(`Found ${burns.length} burns to update`)

  if (burns.length === 0) {
    console.log('No burns to update. Exiting.')
    return
  }

  console.log('\nBurns to update:')
  for (const burn of burns) {
    console.log(`  - ${burn.id} | ${burn.amountTzs} TZS | ${burn.createdAt} | ref: ${burn.payoutReference}`)
  }

  console.log('\nUpdating payoutStatus to "completed"...')

  for (const burn of burns) {
    await db
      .update(burnRequests)
      .set({
        payoutStatus: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(burnRequests.id, burn.id))
    
    console.log(`  ✓ Updated ${burn.id}`)
  }

  console.log(`\n✅ Successfully updated ${burns.length} burn requests`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
