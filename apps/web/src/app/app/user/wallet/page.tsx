import { redirect } from 'next/navigation'

import { requireAnyRole } from '@/lib/auth/rbac'
import { getCachedWallet } from '@/lib/user/cachedWallet'
import { PayMeSection } from './PayMeSection'
import { SendModal } from './SendModal'
import { SwapSection } from './SwapSection'
import { SwapHistory } from './SwapHistory'
import { TopActions } from './_components/TopActions'
import { ActionQueryBridge } from './ActionQueryBridge'
import { WithdrawInline } from './WithdrawInline'

export default async function WalletPage() {
  const dbUser = await requireAnyRole(['end_user', 'super_admin'])

  const wallet = await getCachedWallet(dbUser.id)

  if (!wallet) {
    redirect('/app/user')
  }

  const suggestedAlias = dbUser.email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 30) || 'user'

  return (
    <div className="ntzs-wallet-shell min-h-screen px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="p-0 md:p-0 space-y-4">
          <div id="receive">
            <PayMeSection
              currentAlias={dbUser.payAlias ?? null}
              suggestedAlias={suggestedAlias}
              walletAddress={wallet.address}
            />
          </div>
          <TopActions />
          <ActionQueryBridge />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="rounded-[28px] border border-border/40 bg-card/60 p-5 backdrop-blur-2xl">
              <div className="p-0 md:p-0">
                <SwapHistory />
              </div>
            </div>
          </div>
        </div>

        {/* Modal instances — opened via TopActions events */}
        <SwapSection renderLauncher={false} />
        <SendModal walletAddress={wallet.address} />
        <WithdrawInline userPhone={dbUser.phone} />
      </div>
    </div>
  )
}
