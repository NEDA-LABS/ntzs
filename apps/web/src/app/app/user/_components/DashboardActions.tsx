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
        className="h-12 gap-2 border-blue-950/40 bg-[linear-gradient(110deg,#1e3a8a,45%,#1e40af,55%,#1e3a8a)] text-white hover:shadow-lg hover:shadow-blue-900/40"
      >
        <ArrowUp className="h-4 w-4" />
        Deposit
      </ShimmerButton>

      {/* Save */}
      <ShimmerButton
        onClick={() => router.push('/app/user/stake')}
        className="h-12 gap-2 border-blue-950/40 bg-[linear-gradient(110deg,#1e3a8a,45%,#1e40af,55%,#1e3a8a)] text-white hover:shadow-lg hover:shadow-blue-900/40"
      >
        <Wallet className="h-4 w-4 text-emerald-400" />
        Save
      </ShimmerButton>

      {/* Pay Me */}
      <ShimmerButton
        onClick={() => router.push('/app/user/wallet')}
        className="h-12 gap-2 border-blue-950/40 bg-[linear-gradient(110deg,#1e3a8a,45%,#1e40af,55%,#1e3a8a)] text-white hover:shadow-lg hover:shadow-blue-900/40"
      >
        <Link2 className="h-4 w-4" />
        Pay Me
      </ShimmerButton>
    </div>
  )
}
