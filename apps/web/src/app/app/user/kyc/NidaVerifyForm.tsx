'use client'

import { useActionState } from 'react'

import { verifyNidaAction, type NidaFormState } from './actions'

/**
 * NIDA verification form with inline errors (useActionState) — failed
 * verifications render a message instead of crashing to Next's generic
 * "Application error" screen. Used by the wallet-less activation screen in the
 * user layout and by /app/user/kyc.
 */
export function NidaVerifyForm({ redirectTo = '/app/user' }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState<NidaFormState, FormData>(verifyNidaAction, { error: null })

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <input
        name="nationalId"
        inputMode="numeric"
        placeholder="NIDA number (20 digits)"
        required
        className="rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/40 outline-none focus:border-emerald-500/60"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? 'Verifying…' : 'Verify with NIDA'}
      </button>
      {state.error && (
        <p className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs leading-relaxed text-rose-200">
          {state.error}
        </p>
      )}
    </form>
  )
}
