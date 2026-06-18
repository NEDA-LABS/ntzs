'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV: { group: string; items: { label: string; href: string; soon?: boolean }[] }[] = [
  {
    group: 'Getting started',
    items: [
      { label: 'Overview', href: '/developers/docs' },
      { label: 'Authentication', href: '/developers/docs/authentication' },
    ],
  },
  {
    group: 'Capabilities',
    items: [
      { label: 'Ramp', href: '/developers/docs/ramp' },
      { label: 'Wallets', href: '/developers/docs/wallets', soon: true },
      { label: 'Collections', href: '/developers/docs/collections', soon: true },
      { label: 'Disbursements', href: '/developers/docs/disbursements', soon: true },
      { label: 'Transfers', href: '/developers/docs/transfers', soon: true },
      { label: 'Treasury', href: '/developers/docs/treasury', soon: true },
      { label: 'Swap', href: '/developers/docs/swap', soon: true },
    ],
  },
]

export function DocsSidebar() {
  const pathname = usePathname()
  return (
    <nav className="space-y-6 text-sm">
      {NAV.map((g) => (
        <div key={g.group}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-white/30">{g.group}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = pathname === it.href
              if (it.soon) {
                return (
                  <li key={it.href} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-white/30">
                    {it.label}<span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide">soon</span>
                  </li>
                )
              }
              return (
                <li key={it.href}>
                  <Link href={it.href} className={`block rounded-lg px-3 py-1.5 transition-colors ${active ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5 hover:text-white/80'}`}>
                    {it.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
