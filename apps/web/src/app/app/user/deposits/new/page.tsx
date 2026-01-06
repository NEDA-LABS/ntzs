import { desc, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { requireDbUser, requireRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { banks, kycCases, wallets } from '@ntzs/db'

import { SlideToSubmit } from '@/app/app/_components/SlideToSubmit'
import { IconArrowDown, IconBank, IconCard, IconInfo, IconPhone } from '@/app/app/_components/icons'

import { createDepositRequestAction } from './actions'

export default async function NewDepositPage() {
  await requireRole('end_user')
  const dbUser = await requireDbUser()

  const { db } = getDb()

  const wallet = await db.query.wallets.findFirst({
    where: eq(wallets.userId, dbUser.id),
  })

  if (!wallet) {
    redirect('/app/user/wallet')
  }

  const latestKyc = await db
    .select({ status: kycCases.status })
    .from(kycCases)
    .where(eq(kycCases.userId, dbUser.id))
    .orderBy(desc(kycCases.createdAt))
    .limit(1)

  const kycStatus = latestKyc[0]?.status ?? null

  if (kycStatus !== 'approved') {
    redirect('/app/user/kyc')
  }

  const activeBanks = await db
    .select({ id: banks.id, name: banks.name })
    .from(banks)
    .where(eq(banks.status, 'active'))
    .orderBy(banks.name)
    .limit(50)

  return (
    <div className="p-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Deposit</h1>
          <p className="mt-1 text-sm text-zinc-400">TZS to nTZS (1:1)</p>
        </div>

        {/* Deposit Sheet */}
        <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
          <div className="absolute inset-0 -z-10 rounded-3xl bg-[radial-gradient(circle_at_20%_0%,rgba(121,40,202,0.16),transparent_55%),radial-gradient(circle_at_80%_100%,rgba(0,112,243,0.10),transparent_55%)]" />

          {activeBanks.length ? (
            <form action={createDepositRequestAction} className="space-y-5">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Pay</span>
                  <span className="text-xs text-zinc-600">TZS</span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-4">
                  <input
                    name="amountTzs"
                    type="number"
                    min={1}
                    step={1}
                    required
                    placeholder="0"
                    inputMode="numeric"
                    className="w-full bg-transparent text-4xl font-semibold tracking-tight text-white outline-none placeholder:text-zinc-700"
                  />
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20">
                      <span className="text-sm font-semibold">T</span>
                    </div>
                    <span className="text-sm font-semibold text-white">TZS</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                  <IconArrowDown className="h-5 w-5 text-zinc-300" />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Receive</span>
                  <span className="text-xs text-emerald-300">1:1</span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-4">
                  <div className="w-full text-3xl font-semibold tracking-tight text-zinc-500">≈ same amount</div>
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                    <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
                      <img src="/ntzs-logo.png" alt="nTZS" className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-semibold text-white">nTZS</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    className="flex items-center gap-3 rounded-2xl border border-violet-500/40 bg-violet-500/10 px-4 py-4 text-left text-sm text-white"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
                      <IconBank className="h-5 w-5 text-white/80" />
                    </span>
                    <span>
                      <span className="block font-semibold">Bank</span>
                      <span className="block text-xs text-white/60">Transfer</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled
                    className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-left text-sm opacity-50"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
                      <IconPhone className="h-5 w-5 text-white/70" />
                    </span>
                    <span>
                      <span className="block font-semibold text-white/80">M-Pesa</span>
                      <span className="block text-xs text-white/50">Soon</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled
                    className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-left text-sm opacity-50"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
                      <IconCard className="h-5 w-5 text-white/70" />
                    </span>
                    <span>
                      <span className="block font-semibold text-white/80">Selcom</span>
                      <span className="block text-xs text-white/50">Soon</span>
                    </span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-400">Settlement bank</label>
                <select
                  name="bankId"
                  required
                  defaultValue={activeBanks[0]?.id}
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-violet-500/50"
                >
                  {activeBanks.map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </div>

              <SlideToSubmit label="Slide to deposit" />

              <div className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <IconInfo className="mt-0.5 h-4 w-4 text-zinc-400" />
                <p className="text-sm text-zinc-400">
                  After submitting, we’ll show bank details for the transfer. Minting happens after confirmation.
                </p>
              </div>
            </form>
          ) : (
            <div className="py-12 text-center">
              <p className="text-sm text-zinc-400">No settlement bank is configured yet.</p>
              <p className="mt-1 text-xs text-zinc-600">Please contact support.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
