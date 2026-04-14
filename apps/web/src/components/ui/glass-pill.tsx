import * as React from "react"

import { cn } from "@/lib/utils"

export interface GlassPillProps extends React.HTMLAttributes<HTMLDivElement> {}

export const GlassPill = React.forwardRef<HTMLDivElement, GlassPillProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "ntzs-wallet-pill border border-border/40 bg-background/35 backdrop-blur-2xl",
          className,
        )}
        {...props}
      />
    )
  },
)

GlassPill.displayName = "GlassPill"
