'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UpgradeBanner } from '@/components/ui/upgrade-banner'

export function AnnouncementBanner() {
  const [visible, setVisible] = useState(true)
  const router = useRouter()
  if (!visible) return null
  return (
    <div className="mb-8">
      <UpgradeBanner
        buttonText="New in v1.4.0"
        description="USDT on Base + BNB Smart Chain is now live — no breaking changes"
        onClose={() => setVisible(false)}
        onClick={() => router.push('/simplefx/docs/changelog')}
      />
    </div>
  )
}
