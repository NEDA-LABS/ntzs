'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'

type ReconciliationEntryType = 'untracked_mint' | 'test_mint' | 'manual_correction' | 'double_mint' | 'opening_balance' | 'other'

const TX_HASH_REQUIRED: ReconciliationEntryType[] = ['untracked_mint', 'test_mint', 'double_mint']
const ADDRESS_REQUIRED: ReconciliationEntryType[] = ['untracked_mint', 'test_mint', 'double_mint']

const TYPE_LABELS: Record<ReconciliationEntryType, string> = {
  untracked_mint: 'Untracked Mint — on-chain tx not in DB (requires tx hash)',
  test_mint: 'Test Mint — minted during testing (requires tx hash)',
  double_mint: 'Double Mint — minted twice for one deposit (requires tx hash)',
  manual_correction: 'Manual Correction — balance adjustment (no tx hash needed)',
  opening_balance: 'Opening Balance — bulk historical mints pre-production (no tx hash needed)',
  other: 'Other',
}

const DESCRIPTIONS: Partial<Record<ReconciliationEntryType, string>> = {
  opening_balance: 'Use this to account for tokens minted directly during development, migration, or initial distribution that were not tracked through the deposit flow.',
  manual_correction: 'Use this to correct the tracked supply without a specific on-chain transaction, e.g. a known admin mint done outside the system.',
}

function ReconcileSubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-600 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending && (
        <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {pending ? 'Saving...' : 'Add Reconciliation Entry'}
    </button>
  )
}

interface Props {
  addReconciliationEntryAction: (formData: FormData) => Promise<void>
  discrepancy: number | null
  contractAddress: string
}

export function ReconciliationEntryForm({ addReconciliationEntryAction, discrepancy, contractAddress }: Props) {
  const [entryType, setEntryType] = useState<ReconciliationEntryType>('opening_balance')

  const needsTxHash = TX_HASH_REQUIRED.includes(entryType)
  const needsAddress = ADDRESS_REQUIRED.includes(entryType)
  const description = DESCRIPTIONS[entryType]

  return (
    <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/50 p-6">
      <h3 className="text-base font-semibold text-white mb-1">Add Reconciliation Entry</h3>
      <p className="text-xs text-zinc-500 mb-4">
        Log a supply event that exists on-chain but is not tracked through the deposit flow.
      </p>
      <form action={addReconciliationEntryAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="block text-xs font-medium text-zinc-400 mb-1">Entry Type *</label>
            <select
              name="entryType"
              required
              value={entryType}
              onChange={e => setEntryType(e.target.value as ReconciliationEntryType)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              {(Object.entries(TYPE_LABELS) as [ReconciliationEntryType, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {description && (
              <p className="mt-1.5 text-xs text-zinc-500">{description}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Amount (TZS) *
            </label>
            <input
              type="number"
              name="amountTzs"
              defaultValue={discrepancy ?? undefined}
              placeholder="e.g. 135388"
              required
              min={1}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Reason *
            </label>
            <input
              type="text"
              name="reason"
              placeholder={
                entryType === 'opening_balance'
                  ? 'Pre-production migration mints'
                  : entryType === 'manual_correction'
                  ? 'Admin direct mint for partner onboarding'
                  : 'e.g. Safe tx executed twice'
              }
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Contract Address
              <span className="ml-1 text-zinc-600">(optional — defaults to current)</span>
            </label>
            <input
              type="text"
              name="contractAddress"
              defaultValue={contractAddress}
              placeholder="0x..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
            />
          </div>

          {needsTxHash && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Transaction Hash *
              </label>
              <input
                type="text"
                name="txHash"
                placeholder="0x..."
                required
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
              />
            </div>
          )}

          {needsAddress && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Recipient Address *
              </label>
              <input
                type="text"
                name="toAddress"
                placeholder="0x..."
                required
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
              />
            </div>
          )}

          <div className="sm:col-span-2 lg:col-span-3">
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Notes
              <span className="ml-1 text-zinc-600">(optional)</span>
            </label>
            <input
              type="text"
              name="notes"
              placeholder="Additional context..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
            />
          </div>
        </div>

        <ReconcileSubmitButton />
      </form>
    </div>
  )
}
