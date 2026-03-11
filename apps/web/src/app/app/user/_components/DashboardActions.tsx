'use client'

import { useRouter } from 'next/navigation'
import ShimmerButton from '@/components/ui/shimmer-button'
import { ArrowUp, Wallet, Link2 } from 'lucide-react'

export function DashboardActions() {
  const router = useRouter()

  return (
    <div className="grid grid-cols-3 gap-3">
      {/* Deposit */}
      <ShimmerButton
        onClick={() => router.push('/app/user/deposits/new')}
        className="h-12 gap-2 border-blue-600/20 bg-[linear-gradient(110deg,#2563eb,45%,#3b82f6,55%,#2563eb)] text-white hover:shadow-lg hover:shadow-blue-500/25"
      >
        <ArrowUp className="h-4 w-4" />
        Deposit
      </ShimmerButton>

      {/* Save */}
      <ShimmerButton
        onClick={() => router.push('/app/user/stake')}
        className="h-12 gap-2 border-blue-900/30 bg-[linear-gradient(110deg,#1e3a8a,45%,#1e40af,55%,#1e3a8a)] text-white"
      >
        <Wallet className="h-4 w-4 text-emerald-400" />
        Save
      </ShimmerButton>

      {/* Pay Me */}
      <ShimmerButton
        onClick={() => router.push('/app/user/wallet')}
        className="h-12 gap-2 border-blue-600/20 bg-[linear-gradient(110deg,#2563eb,45%,#3b82f6,55%,#2563eb)] text-white hover:shadow-lg hover:shadow-blue-500/25"
      >
        <Link2 className="h-4 w-4" />
        Pay Me
      </ShimmerButton>
    </div>
  )
}
