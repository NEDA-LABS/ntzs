"use client"

import Link from "next/link"
import { IconSend, IconTrendingUp, IconWithdraw, IconWallet } from "@/app/app/_components/icons"

export function TopActions() {
  const items = [
    { label: "Receive", href: "#receive", icon: IconWallet },
    { label: "Send", href: "#send", icon: IconSend },
    { label: "Swap", href: "#swap", icon: IconTrendingUp },
    { label: "Withdraw", href: "/app/user/withdraw", icon: IconWithdraw },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <Link
          key={it.label}
          href={it.href}
          prefetch
          className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/35 px-4 py-2 text-sm font-semibold text-foreground/90 backdrop-blur-xl transition-colors hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring"
        >
          <it.icon className="h-4 w-4 text-muted-foreground" />
          {it.label}
        </Link>
      ))}
    </div>
  )
}
