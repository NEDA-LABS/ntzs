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
        'inline-flex h-12 items-center justify-center rounded-xl border border-slate-800 bg-[length:200%_100%] px-6 font-medium transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 hover:animate-[shimmer2_1s_ease-in-out] active:animate-[shimmer2_0.5s_ease-in-out]',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
