'use client'

import { useRouter } from 'next/navigation'
import { PopButton } from '@/components/ui/pop-button'
import { ArrowUp, Wallet, Link2 } from 'lucide-react'

export function DashboardActions() {
  const router = useRouter()

  return (
    <div className="grid grid-cols-3 gap-3">
      {/* Deposit */}
      <PopButton
        color="blue"
        size="lg"
        onClick={() => router.push('/app/user/deposits/new')}
        className="gap-2 rounded-3xl"
      >
        <ArrowUp className="h-4 w-4" />
        Deposit
      </PopButton>

      {/* Save */}
      <PopButton
        color="default"
        size="lg"
        onClick={() => router.push('/app/user/stake')}
        className="gap-2 rounded-3xl"
      >
        <Wallet className="h-4 w-4 text-emerald-500" />
        Save
      </PopButton>

      {/* Pay Me */}
      <PopButton
        color="blue"
        size="lg"
        onClick={() => router.push('/app/user/wallet')}
        className="gap-2 rounded-3xl"
      >
        <Link2 className="h-4 w-4" />
        Pay Me
      </PopButton>
    </div>
  )
}
