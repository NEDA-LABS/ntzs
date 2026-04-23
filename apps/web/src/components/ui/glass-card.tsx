import * as React from "react"

import { cn } from "@/lib/utils"

const glassCardVariants = {
  base: "relative overflow-hidden rounded-[28px] border border-border/40 bg-card/70 shadow-[0_30px_90px_rgba(3,7,18,0.32)] backdrop-blur-2xl",
  subtleGlow: "before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_38%,transparent_100%)] before:opacity-90",
}

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  innerClassName?: string
}

export const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, innerClassName, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(glassCardVariants.base, glassCardVariants.subtleGlow, className)}
        {...props}
      >
        <div className={cn("relative z-10", innerClassName)}>{children}</div>
      </div>
    )
  }
)

GlassCard.displayName = "GlassCard"
