'use client'

import { useFormStatus } from 'react-dom'

interface SubmitButtonProps {
  children: React.ReactNode
  pendingText?: string
  className?: string
  disabled?: boolean
}

/**
 * Drop-in replacement for <button type="submit"> inside server-action forms.
 * Uses useFormStatus to detect when the nearest ancestor form is submitting,
 * then shows a spinner and prevents double-submit automatically.
 */
export function SubmitButton({ children, pendingText, className = '', disabled = false }: SubmitButtonProps) {
  const { pending } = useFormStatus()
  const isDisabled = pending || disabled

  return (
    <button
      type="submit"
      disabled={isDisabled}
      className={`inline-flex items-center gap-1.5 transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {pending && (
        <svg
          className="h-3.5 w-3.5 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {pending && pendingText ? pendingText : children}
    </button>
  )
}
