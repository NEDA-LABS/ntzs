'use client'

import { useEffect, useState } from 'react'

type Method = 'mobile' | 'card' | undefined

export function DepositSuccessToast() {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState<number | null>(null)
  const [method, setMethod] = useState<Method>(undefined)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('deposit_success')
      if (!raw) return
      sessionStorage.removeItem('deposit_success')
      const data = JSON.parse(raw) as { amount?: number; method?: Method }
      if (data && typeof data.amount === 'number' && data.amount > 0) {
        setAmount(data.amount)
        setMethod(data.method)
        setOpen(true)
        const t = setTimeout(() => setOpen(false), 4000)
        return () => clearTimeout(t)
      }
    } catch {
      // ignore
    }
  }, [])

  if (!open) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border border-emerald-500/20 bg-[#0b0f12] p-4 shadow-2xl ring-1 ring-white/5">
        <div className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />
        <div className="flex-1 text-sm">
          <div className="font-semibold text-white">Deposit submitted</div>
          <div className="mt-0.5 text-white/70">
            {amount ? `${amount.toLocaleString()} TZS` : ''}
            {method === 'card' ? ' — follow checkout to complete your payment.' : ' — check your phone to approve the payment.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
