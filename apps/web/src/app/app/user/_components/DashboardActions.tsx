'use client'

import { useRouter } from 'next/navigation'
import { InteractiveHoverButton } from '@/components/ui/interactive-hover-button'

export function DashboardActions() {
  const router = useRouter()

  return (
    <div className="mb-6 flex items-center gap-3 flex-wrap">
      <InteractiveHoverButton
        text="Deposit"
        variant="default"
        onClick={() => router.push('/app/user/deposits/new')}
        className="min-w-[120px]"
      />
      <button
        disabled
        className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-transparent px-5 py-2.5 text-sm font-medium text-white/30 cursor-not-allowed"
      >
        Send
      </button>
      <InteractiveHoverButton
        text="Pay Me"
        variant="primary"
        onClick={() => router.push('/app/user/wallet')}
        className="min-w-[120px]"
      />
    </div>
  )
}
