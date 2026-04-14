import { and, eq } from 'drizzle-orm'

import { requireAnyRole, requireDbUser } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { savingsPositions, savingsProducts } from '@ntzs/db'

import { SavingsDeposit } from './_components/SavingsDeposit'

export default async function StakePage() {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()
  const { db } = getDb()

  const [product] = await db
    .select({
      id: savingsProducts.id,
      name: savingsProducts.name,
      description: savingsProducts.description,
      annualRateBps: savingsProducts.annualRateBps,
      lockDays: savingsProducts.lockDays,
      minDepositTzs: savingsProducts.minDepositTzs,
    })
    .from(savingsProducts)
    .where(eq(savingsProducts.status, 'active'))
    .limit(1)

  if (!product) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-white/30">Savings products are temporarily unavailable.</p>
      </div>
    )
  }

  const [position] = await db
    .select({
      principalTzs: savingsPositions.principalTzs,
      accruedYieldTzs: savingsPositions.accruedYieldTzs,
      totalDepositedTzs: savingsPositions.totalDepositedTzs,
      openedAt: savingsPositions.openedAt,
    })
    .from(savingsPositions)
    .where(
      and(
        eq(savingsPositions.userId, dbUser.id),
        eq(savingsPositions.productId, product.id),
        eq(savingsPositions.status, 'active'),
      )
    )
    .limit(1)

  const ratePercent = product.annualRateBps / 100
  const hasFunds = !!position && position.principalTzs > 0

  const dailyYield = hasFunds
    ? Math.floor((position!.principalTzs * product.annualRateBps) / 10_000 / 365)
    : null

  const annualProjection = hasFunds
    ? Math.floor((position!.principalTzs * product.annualRateBps) / 10_000)
    : null

  const serialisedPosition = position
    ? {
        principalTzs: position.principalTzs,
        accruedYieldTzs: position.accruedYieldTzs,
        totalDepositedTzs: position.totalDepositedTzs,
        openedAt: position.openedAt?.toISOString() ?? new Date().toISOString(),
      }
    : null

  return (
    <div className="min-h-screen">
      <div className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-lg">

          {/* Page header */}
          <div className="mb-10">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Savings</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Your TZS working for you — {ratePercent}% per annum, accrued daily
            </p>
          </div>

          {/* Animated savings card — hero, sticky on scroll */}
          <div className="sticky top-14 z-20 pb-4 pt-1 lg:top-0">
            <SavingsDeposit
              product={product}
              position={serialisedPosition}
            />
          </div>

          {/* Stats — only when user has an active position */}
          {hasFunds && position && (
            <div className="mb-8 grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-border/40 bg-card/60 p-4 text-center backdrop-blur-2xl">
                <div className="text-xl font-bold text-emerald-400">
                  +{dailyYield?.toLocaleString()}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">Daily TZS</div>
              </div>
              <div className="rounded-2xl border border-border/40 bg-card/60 p-4 text-center backdrop-blur-2xl">
                <div className="text-xl font-bold text-white">
                  {annualProjection?.toLocaleString()}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">Annual TZS</div>
              </div>
              <div className="rounded-2xl border border-border/40 bg-card/60 p-4 text-center backdrop-blur-2xl">
                <div className="text-xl font-bold text-violet-400">{ratePercent}%</div>
                <div className="mt-1 text-[11px] text-muted-foreground">Rate p.a.</div>
              </div>
            </div>
          )}

          {/* How it works */}
          <div className="rounded-2xl border border-border/40 bg-card/60 p-6 backdrop-blur-2xl">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              How it works
            </h3>
            <div className="mt-5 space-y-5">
              {[
                {
                  step: '01',
                  title: 'Deposit TZS',
                  body: `Transfer Tanzanian Shillings into your savings position. Minimum ${product.minDepositTzs > 0 ? product.minDepositTzs.toLocaleString() + ' TZS' : 'no minimum'}.`,
                },
                {
                  step: '02',
                  title: 'Earn daily',
                  body: `Yield accrues every day at ${ratePercent}% p.a. No lock-up period. Your balance compounds over time.`,
                },
                {
                  step: '03',
                  title: 'Withdraw any time',
                  body: 'Request your principal and earned yield back to your wallet whenever you need it.',
                },
              ].map(({ step, title, body }) => (
                <div key={step} className="flex gap-4">
                  <div className="mt-0.5 shrink-0 font-mono text-xs text-violet-500/50">
                    {step}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{title}</div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Product details */}
          <div className="mt-3 rounded-2xl border border-border/40 bg-card/60 p-6 backdrop-blur-2xl">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Product details
            </h3>
            <div className="mt-4 divide-y divide-border/40">
              {[
                { label: 'Annual rate', value: `${ratePercent}% p.a.` },
                {
                  label: 'Lock period',
                  value: product.lockDays === 0 ? 'None — withdraw any time' : `${product.lockDays} days`,
                },
                {
                  label: 'Minimum deposit',
                  value: product.minDepositTzs > 0
                    ? `${product.minDepositTzs.toLocaleString()} TZS`
                    : 'No minimum',
                },
                { label: 'Accrual frequency', value: 'Daily' },
                { label: 'Currency', value: 'Tanzanian Shilling (TZS)' },
                { label: 'Yield settlement', value: 'On withdrawal' },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <span className="text-white/40">{label}</span>
                  <span className="font-medium text-white">{value}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
