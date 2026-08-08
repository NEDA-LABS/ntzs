import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { requireDbUser, requireAnyRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { expectedDisbursementRail } from '@/lib/psp'
import { BANK_FI_CODES } from '@/lib/psp/selcom'
import { railLabel } from '@/lib/psp/selcom-fees'
import { SAFE_BURN_THRESHOLD_TZS } from '@/lib/approvals/thresholds'
import { kycCases, wallets } from '@ntzs/db'
import { readAvailability } from '@/lib/burns/available'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'

import { WithdrawForm } from './WithdrawForm'

export default async function WithdrawPage() {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const { db } = getDb()

  const userWallets = await db.query.wallets.findMany({
    where: and(eq(wallets.userId, dbUser.id), eq(wallets.chain, 'base'), eq(wallets.frozen, false)),
  })
  if (!userWallets.length) redirect('/app/user/wallet')

  const approvedKyc = await db
    .select({ id: kycCases.id })
    .from(kycCases)
    .where(and(eq(kycCases.userId, dbUser.id), eq(kycCases.status, 'approved')))
    .limit(1)
  if (!approvedKyc.length) redirect('/app/user/kyc')

  // What the participant can actually withdraw, read from the chain by the same
  // function the withdrawal action uses to refuse — so the figure on the screen
  // and the refusal behind it can never describe different worlds. A read
  // failure shows zero and the action still refuses on its own read; it never
  // shows a balance we could not confirm.
  const availability =
    NTZS_CONTRACT_ADDRESS_BASE && BASE_RPC_URL
      ? await readAvailability(userWallets, {
          rpcUrl: BASE_RPC_URL,
          contractAddress: NTZS_CONTRACT_ADDRESS_BASE,
        }).catch(() => null)
      : null

  // The rail the payout will be tried on first — prices the network fee shown
  // in the form (Selcom is tiered; Snippe is a flat 1,500).
  const expectedRail = expectedDisbursementRail()

  // Bank payouts ride Selcom only, so the destination is offered only when
  // that rail is switched on. BANK_FI_CODES is server-only (it lives beside
  // the Selcom client), hence the codes are passed down as plain data.
  const bankPayoutsEnabled = process.env.SELCOM_DISBURSEMENTS_ENABLED === 'true'
  const banks = bankPayoutsEnabled
    ? Object.entries(BANK_FI_CODES)
        .map(([code, meta]) => ({ code, name: meta.name, reference: meta.reference }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : []

  return (
    <div className="px-4 py-6 lg:p-8">
      <div className="mx-auto max-w-md sm:max-w-xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Withdraw</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            nTZS to TZS (1:1) — paid out to {banks.length ? 'mobile money or your bank account' : `${railLabel(expectedRail)} mobile money`}
          </p>
        </div>

        <WithdrawForm
          userPhone={dbUser.phone}
          expectedRail={expectedRail}
          banks={banks}
          approvalThresholdTzs={SAFE_BURN_THRESHOLD_TZS}
          availableTzs={availability?.maxTzs ?? 0}
          totalTzs={availability?.totalTzs ?? 0}
          splitAcrossWallets={availability?.splitAcrossWallets ?? false}
        />
      </div>
    </div>
  )
}
