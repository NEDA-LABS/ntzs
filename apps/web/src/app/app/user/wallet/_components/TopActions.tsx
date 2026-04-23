"use client"

import { IconTrendingUp, IconWithdraw, IconSend } from "@/app/app/_components/icons"

function emit(name: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(name))
  }
}

export function TopActions() {
  const items = [
    { label: "Swap", icon: IconTrendingUp, onClick: () => emit('wallet:openSwap') },
    { label: "Send", icon: IconSend, onClick: () => emit('wallet:openSend') },
    { label: "Withdraw", icon: IconWithdraw, onClick: () => emit('wallet:openWithdraw') },
  ] as const
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={it.onClick}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border/40 bg-background/35 px-4 py-2.5 text-sm font-semibold text-foreground/90 backdrop-blur-xl transition-colors hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring"
          aria-label={it.label}
        >
          <it.icon className="h-4 w-4 text-muted-foreground" />
          {it.label}
        </button>
      ))}
    </div>
  )
}
