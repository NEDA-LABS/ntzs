"use client"

import Link from "next/link"

import { IconWallet, IconPlus, IconReceipt, IconSparkles, IconSend, IconTrendingUp } from "@/app/app/_components/icons"

export function QuickIntentsGrid() {
  const items = [
    {
      href: "/app/user/wallet#receive",
      icon: IconWallet,
      title: "Receive",
      sub: "Alias + QR to collect TZS",
    },
    {
      href: "/app/user/wallet#send",
      icon: IconSend,
      title: "Send",
      sub: "Transfer to 0x or @alias",
    },
    {
      href: "/app/user/wallet#swap",
      icon: IconTrendingUp,
      title: "Swap",
      sub: "Exchange nTZS and USDC",
    },
    {
      href: "/app/user/deposits/new",
      icon: IconPlus,
      title: "Deposit",
      sub: "Add funds to wallet",
    },
    {
      href: "/app/user/stake",
      icon: IconSparkles,
      title: "Stake",
      sub: "Earn yield on TZS",
    },
    {
      href: "/app/user/activity",
      icon: IconReceipt,
      title: "Activity",
      sub: "Recent transactions",
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          prefetch
          className="group rounded-2xl border border-border/40 bg-background/35 p-4 text-left backdrop-blur-xl transition-colors hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/40 bg-background/50">
              <it.icon className="h-4 w-4 text-foreground/80" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{it.title}</p>
              <p className="text-[11px] text-muted-foreground">{it.sub}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
