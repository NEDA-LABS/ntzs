import * as React from "react"

import { cn } from "@/lib/utils"

export interface GlassInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

export const GlassInput = React.forwardRef<HTMLInputElement, GlassInputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-xl border border-border/40 bg-background/60 px-4 py-3 text-sm text-foreground",
          "placeholder:text-muted-foreground backdrop-blur-xl",
          "focus-visible:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    )
  },
)

GlassInput.displayName = "GlassInput"
