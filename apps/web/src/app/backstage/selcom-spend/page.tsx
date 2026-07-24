import { requireAnyRole } from '@/lib/auth/rbac'
import { getBalance } from '@/lib/psp/selcom'

import SpendTestForm from './SpendTestForm'

export const dynamic = 'force-dynamic'

/**
 * Backstage → Selcom spend test: the click-a-button face of
 * POST /api/admin/selcom-spend-test, so validating the neda-bill-pay /
 * neda-lipa-payout rails on go-live day never requires curl.
 *
 * The page states the go-live preconditions with live status (creds, flags,
 * account float) and the form fires ONE capped, audit-logged test transaction
 * through the same API route an engineer would call — one code path, no
 * duplicated money-moving logic.
 */
export default async function SelcomSpendPage() {
  await requireAnyRole(['super_admin'])

  const credsConfigured = Boolean(
    process.env.SELCOM_API_KEY && process.env.SELCOM_PRIVATE_KEY && process.env.SELCOM_ACCOUNT_NUMBER
  )
  const billEnabled = process.env.SELCOM_BILLPAY_ENABLED === 'true'
  const lipaEnabled = process.env.SELCOM_LIPA_ENABLED === 'true'

  // Live float check — read-only; the test bounces on an empty account.
  let balanceTzs: number | null = null
  let balanceError: string | null = null
  if (credsConfigured) {
    try {
      const b = await getBalance()
      balanceTzs = b.available
    } catch (e) {
      balanceError = e instanceof Error ? e.message.slice(0, 140) : 'balance read failed'
    }
  }

  const check = (ok: boolean, okText: string, badText: string) => (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          ok ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
        }`}
      >
        {ok ? '✓' : '·'}
      </span>
      <span className="text-sm text-zinc-300">{ok ? okText : badText}</span>
    </li>
  )

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Selcom Spend Test</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Fire one small, capped test payment over the new bill-pay / Lipa Namba rails and see Selcom&apos;s answer
          plus the settled status. Real money moves from the custodial account when the rails are live — max 5,000 TZS
          per test, every click audit-logged.
        </p>
      </div>

      <div className="mb-6 rounded-2xl border border-white/10 bg-zinc-950 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">Go-live checklist</h2>
        <ul className="space-y-3">
          {check(
            credsConfigured,
            'Selcom API credentials configured and active.',
            'Selcom API credentials missing (SELCOM_API_KEY / SELCOM_PRIVATE_KEY / SELCOM_ACCOUNT_NUMBER).'
          )}
          <li className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-500/20 text-xs font-bold text-zinc-400">
              ?
            </span>
            <span className="text-sm text-zinc-300">
              Selcom deploys the neda-bill-pay / neda-lipa-payout endpoints on their side — confirm with Dhimant
              (also owed: fee tariffs + the biller-code catalogue). Until then a test returns their error, which is
              harmless and itself confirms the wiring.
            </span>
          </li>
          {check(
            balanceTzs != null && balanceTzs > 0,
            `Account has float: TZS ${balanceTzs?.toLocaleString('en-US')} available.`,
            balanceError
              ? `Account balance unreadable right now (${balanceError}).`
              : `Account float is TZS ${balanceTzs?.toLocaleString('en-US') ?? '0'} — move a small float (10–20k TZS) in first or the test bounces for insufficient balance.`
          )}
          {check(
            billEnabled,
            'SELCOM_BILLPAY_ENABLED=true — bill/airtime rail armed.',
            'SELCOM_BILLPAY_ENABLED not set in Vercel — bill/airtime rail off (add the var, redeploy).'
          )}
          {check(
            lipaEnabled,
            'SELCOM_LIPA_ENABLED=true — Lipa Namba rail armed.',
            'SELCOM_LIPA_ENABLED not set in Vercel — Lipa Namba rail off (add the var, redeploy).'
          )}
        </ul>
        <p className="mt-4 text-xs text-zinc-500">
          Recommended first test once everything above is green: 1,000 TZS airtime to your own phone number
          (utility code ATOP) — self-verifying, the airtime lands on your handset.
        </p>
      </div>

      <SpendTestForm billEnabled={billEnabled} lipaEnabled={lipaEnabled} />
    </div>
  )
}
