'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { migrateLegacyWalletAction, type MigrateLegacyResult } from '@/app/app/user/wallet/actions'

interface Props {
  amountTzs: number
  fromAddress: string
}

export function LegacyWalletMigrationBanner({ amountTzs, fromAddress }: Props) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<MigrateLegacyResult | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const router = useRouter()

  if (dismissed) return null

  // Success state
  if (result && 'success' in result && result.success && 'burnTxHash' in result) {
    return (
      <div className="mx-4 mt-4 sm:mx-8">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 backdrop-blur-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-emerald-300">Migration complete</p>
              <p className="mt-1 text-sm text-foreground/80">
                {result.migratedTzs.toLocaleString()} TZS moved to your primary wallet.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setDismissed(true)
                router.refresh()
              }}
              className="rounded-lg border border-border/40 bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground/80 hover:bg-background/70"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    )
  }

  const shortFrom = `${fromAddress.slice(0, 6)}...${fromAddress.slice(-4)}`

  return (
    <div className="mx-4 mt-4 sm:mx-8">
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 backdrop-blur-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-300">Legacy wallet detected</p>
            <p className="mt-1 text-sm text-foreground/80">
              You have <span className="font-semibold">{amountTzs.toLocaleString()} TZS</span> in an older wallet ({shortFrom}) that isn&apos;t showing in your balance. Migrate now to consolidate.
            </p>
            {result && 'success' in result && !result.success && (
              <p className="mt-2 text-xs text-rose-300">{result.error}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const res = await migrateLegacyWalletAction()
                  setResult(res)
                  if ('success' in res && res.success && 'burnTxHash' in res) {
                    router.refresh()
                  }
                })
              }}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950 transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {isPending ? 'Migrating...' : 'Migrate now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
