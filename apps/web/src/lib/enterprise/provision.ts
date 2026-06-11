import crypto from 'crypto'

import { getDb } from '@/lib/db'
import { hashApiKey } from '@/lib/waas/auth'
import { generatePartnerSeed, deriveTreasuryAddress } from '@/lib/waas/hd-wallets'
import { partners } from '@ntzs/db'
import { writeAuditLog } from '@/lib/audit'

export interface ProvisionedPartner {
  partnerId: string
  treasuryWalletAddress: string
}

/**
 * Provision a dedicated WaaS partner + treasury wallet to back an enterprise
 * account (capital lender / disbursement client).
 *
 * In this system the `partner` is the financial container: it owns the treasury
 * wallet and is the key merchants attach to (merchant_accounts.lender_partner_id).
 * An enterprise_account is only a login that points at a partner. Each enterprise
 * gets its OWN partner so merchant books never collide.
 *
 * WaaS-only fields are handled here because lenders aren't WaaS API customers:
 *   - an apiKeyHash is minted only because the column is NOT NULL (the key is
 *     not returned or used);
 *   - the WaaS joining/monthly fees are zeroed (the schema defaults are
 *     $50k / $2k, which must never apply to a lender).
 *
 * The partner's primary treasury (HD index 0) becomes the lender's treasury, so
 * no sub-wallet is needed.
 */
export async function provisionEnterprisePartner(opts: { name: string }): Promise<ProvisionedPartner> {
  const { db } = getDb()

  const { encryptedSeed } = generatePartnerSeed()
  const treasuryWalletAddress = deriveTreasuryAddress(encryptedSeed)

  // apiKeyHash is NOT NULL on partners — mint a key purely to satisfy the
  // constraint. Lenders authenticate via enterprise_accounts, not this key.
  const isProduction = process.env.NODE_ENV === 'production'
  const apiKey = `${isProduction ? 'ntzs_live_' : 'ntzs_test_'}${crypto.randomBytes(20).toString('hex')}`

  const [partner] = await db
    .insert(partners)
    .values({
      name: opts.name,
      // email left null: lenders sign in through enterprise_accounts, and the
      // partners.email unique index must not collide with a real WaaS partner.
      email: null,
      apiKeyHash: hashApiKey(apiKey),
      apiKeyPrefix: apiKey.slice(0, 14),
      webhookSecret: `whsec_${crypto.randomBytes(24).toString('hex')}`,
      encryptedHdSeed: encryptedSeed,
      treasuryWalletAddress,
      isActive: true,
      // Not a WaaS-billed customer.
      joiningFeeUsd: '0',
      monthlyFeeUsd: '0',
    })
    .returning({ id: partners.id })

  if (!partner) throw new Error('Failed to provision enterprise partner')

  await writeAuditLog('partner.created', 'partner', partner.id, {
    name: opts.name,
    via: 'enterprise_auto_provision',
    treasuryWalletAddress,
  })

  return { partnerId: partner.id, treasuryWalletAddress }
}
