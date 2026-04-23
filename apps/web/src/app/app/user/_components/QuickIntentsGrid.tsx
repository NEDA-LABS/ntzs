"use client"

import Link from "next/link"

type GridItem = {
  href: string
  title: string
  sub: string
  image?: string
  image2?: string
}

export function QuickIntentsGrid() {
  const items: GridItem[] = [
    { href: "/app/user/wallet?action=receive", title: "Receive", sub: "Alias + QR to collect TZS", image: "/ntzs-icon.svg" },
    { href: "/app/user/wallet?action=send",    title: "Send",    sub: "Transfer to 0x or @alias",     image: "/ntzs-icon.svg" },
    { href: "/app/user/wallet?action=swap",    title: "Swap",    sub: "Exchange nTZS and USDC",       image: "/ntzs-icon.svg" },
    { href: "/app/user/deposits/new",          title: "Deposit", sub: "Add funds to wallet",          image: "/ntzs-icon.svg" },
    { href: "/app/user/stake",                 title: "Stake",   sub: "Earn yield on TZS",            image: "/ntzs-icon.svg" },
    { href: "/app/user/activity",              title: "Activity",sub: "Recent transactions",          image: "/ntzs-icon.svg" },
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
              <img src={it.image} alt="icon" className="h-4 w-4" />
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
