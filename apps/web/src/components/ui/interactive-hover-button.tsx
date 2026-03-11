'use client'

import React from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InteractiveHoverButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string
  variant?: 'default' | 'primary' | 'outline'
}

const InteractiveHoverButton = React.forwardRef<
  HTMLButtonElement,
  InteractiveHoverButtonProps
>(({ text = 'Button', className, variant = 'default', ...props }, ref) => {
  const accentBg =
    variant === 'primary' ? 'bg-blue-700' : 'bg-blue-600'

  const baseBg =
    variant === 'primary'
      ? 'bg-blue-600 text-white border-blue-600/40'
      : variant === 'outline'
      ? 'bg-transparent text-zinc-300 border-white/15'
      : 'bg-white text-black border-transparent'

  return (
    <button
      ref={ref}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-full border px-5 py-2.5 text-center text-sm font-semibold',
        baseBg,
        className,
      )}
      {...props}
    >
      <span className="inline-block translate-x-1 transition-all duration-300 group-hover:translate-x-12 group-hover:opacity-0">
        {text}
      </span>
      <div className="absolute top-0 z-10 flex h-full w-full translate-x-12 items-center justify-center gap-2 text-white opacity-0 transition-all duration-300 group-hover:-translate-x-1 group-hover:opacity-100">
        <span>{text}</span>
        <ArrowRight className="h-4 w-4" />
      </div>
      <div
        className={cn(
          'absolute left-[20%] top-[40%] h-2 w-2 scale-[1] rounded-full transition-all duration-300 group-hover:left-[0%] group-hover:top-[0%] group-hover:h-full group-hover:w-full group-hover:scale-[1.8]',
          accentBg,
        )}
      />
    </button>
  )
})

InteractiveHoverButton.displayName = 'InteractiveHoverButton'

export { InteractiveHoverButton }
