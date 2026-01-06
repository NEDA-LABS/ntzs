import Link from 'next/link'
import { requireRole } from '@/lib/auth/rbac'

import { IconSparkles } from '@/app/app/_components/icons'

export default async function StakePage() {
  await requireRole('end_user')

  return (
    <div className="min-h-screen">
      <div className="p-8">
        <div className="mx-auto max-w-2xl">
          {/* Coming Soon Card */}
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,rgba(121,40,202,0.18),transparent_55%),radial-gradient(circle_at_80%_100%,rgba(0,112,243,0.10),transparent_55%)]" />
            <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-violet-500/20">
              <IconSparkles className="h-10 w-10 text-violet-300" />
            </div>

            <h2 className="relative mt-6 text-2xl font-bold text-white">Coming Soon</h2>
            <p className="relative mt-3 text-zinc-400">
              Stake your nTZS and earn up to 8% APY. Your stablecoin will work for you while maintaining full liquidity.
            </p>

            {/* Features Preview */}
            <div className="relative mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="text-2xl font-bold text-emerald-400">8%</div>
                <div className="mt-1 text-xs text-zinc-500">Maximum APY</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="text-2xl font-bold text-violet-400">Flexible</div>
                <div className="mt-1 text-xs text-zinc-500">Lock Periods</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="text-2xl font-bold text-blue-400">Daily</div>
                <div className="mt-1 text-xs text-zinc-500">Reward Payouts</div>
              </div>
            </div>

            {/* Notify Form */}
            <div className="relative mt-8">
              <p className="text-sm text-zinc-500">Get notified when staking goes live</p>
              <div className="mt-3 flex gap-3">
                <input
                  type="email"
                  placeholder="Enter your email"
                  className="flex-1 rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-white placeholder:text-zinc-600 outline-none focus:border-violet-500/50"
                />
                <button className="rounded-xl bg-violet-500 px-6 py-3 font-semibold text-white transition-colors hover:bg-violet-600">
                  Notify Me
                </button>
              </div>
            </div>
          </div>

          {/* How It Works */}
          <div className="mt-8 rounded-2xl border border-white/10 bg-black/40 p-6">
            <h3 className="font-semibold text-white">How Staking Works</h3>
            <div className="mt-4 space-y-4">
              <div className="flex gap-4">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-sm font-bold text-violet-400">
                  1
                </div>
                <div>
                  <p className="font-medium text-white">Deposit nTZS</p>
                  <p className="mt-1 text-sm text-zinc-500">Choose how much nTZS you want to stake</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-sm font-bold text-violet-400">
                  2
                </div>
                <div>
                  <p className="font-medium text-white">Select Duration</p>
                  <p className="mt-1 text-sm text-zinc-500">Longer lock periods earn higher rewards</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-sm font-bold text-violet-400">
                  3
                </div>
                <div>
                  <p className="font-medium text-white">Earn Rewards</p>
                  <p className="mt-1 text-sm text-zinc-500">Receive daily payouts directly to your wallet</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
