'use client'

/**
 * @author: @emerald-ui
 * @description: An animated button with a shimmer gradient effect that moves on hover/active
 * @version: 1.0.0
 * @date: 2026-02-11
 * @license: MIT
 * @website: https://emerald-ui.com
 */

import { cn } from '@/lib/utils'

interface ShimmerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode
  className?: string
}

export default function ShimmerButton({
  children = 'Shimmer',
  className,
  ...props
}: ShimmerButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-[linear-gradient(110deg,#fff,45%,#f1f1f1,55%,#fff)] bg-[length:200%_100%] px-6 font-medium text-slate-600 transition-all duration-300 focus:ring-slate-700 focus:ring-offset-2 focus:ring-offset-slate-400 focus:outline-none focus-visible:ring-2 hover:animate-[shimmer2_1s_ease-in-out] active:animate-[shimmer2_0.5s_ease-in-out] dark:border-slate-800 dark:bg-[linear-gradient(110deg,#000103,45%,#1e2631,55%,#000103)] dark:text-slate-400 dark:focus:ring-slate-300',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
