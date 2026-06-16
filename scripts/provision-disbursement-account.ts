#!/usr/bin/env tsx
/**
 * One-off: provision a partner + treasury for an already-active enterprise
 * account that has no partner_id (so it can't use the portal — disbursement
 * upload / lender actions all require account.partnerId).
 *
 * The backstage approve route auto-provisions a partner, but it's gated on
 * !isActive, so accounts that were activated before/around that change can be
 * left stranded. This heals them, mirroring the one-off lender provisioning.
 *
 * Safe-by-default: dry-run unless --apply is passed.
 *
 * Usage:
 *   tsx scripts/provision-disbursement-account.ts --email peepstudio2@gmail.com
 *   tsx scripts/provision-disbursement-account.ts --email peepstudio2@gmail.com --apply
 *
 * Required env: DATABASE_URL, WAAS_ENCRYPTION_KEY
 */
import { eq } from 'drizzle-orm'

import { getDb } from '../apps/web/src/lib/db'
import { provisionEnterprisePartner } from '../apps/web/src/lib/enterprise/provision'
import { enterpriseAccounts } from '@ntzs/db'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const email = arg('email')?.toLowerCase().trim()
  const apply = process.argv.includes('--apply')
  if (!email) {
    console.error('Usage: tsx scripts/provision-disbursement-account.ts --email <email> [--apply]')
    process.exit(1)
  }

  const { db } = getDb()

  const [account] = await db
    .select({
      id: enterpriseAccounts.id,
      name: enterpriseAccounts.name,
      email: enterpriseAccounts.email,
      type: enterpriseAccounts.type,
      isActive: enterpriseAccounts.isActive,
      partnerId: enterpriseAccounts.partnerId,
    })
    .from(enterpriseAccounts)
    .where(eq(enterpriseAccounts.email, email))
    .limit(1)

  if (!account) {
    console.error(`No enterprise account found for ${email}`)
    process.exit(1)
  }

  console.log('Account:', account)

  if (account.partnerId) {
    console.log(`Already linked to partner ${account.partnerId} — nothing to do.`)
    return
  }
  if (!account.isActive) {
    console.log('Account is not active — approve it via backstage instead (that path auto-provisions).')
    return
  }

  if (!apply) {
    console.log('\nDRY-RUN. Would provision a dedicated partner + treasury and link it to this account.')
    console.log('Re-run with --apply to execute.')
    return
  }

  console.log('\nProvisioning partner + treasury...')
  const provisioned = await provisionEnterprisePartner({ name: account.name })
  await db
    .update(enterpriseAccounts)
    .set({ partnerId: provisioned.partnerId, updatedAt: new Date() })
    .where(eq(enterpriseAccounts.id, account.id))

  console.log('Done:', {
    accountId: account.id,
    partnerId: provisioned.partnerId,
    treasuryWalletAddress: provisioned.treasuryWalletAddress,
  })
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
