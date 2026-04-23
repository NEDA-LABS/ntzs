'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { label: 'Overview', href: '/simplefx/docs/overview' },
  { label: 'API Reference', href: '/simplefx/docs/api-reference' },
  { label: 'Webhooks', href: '/simplefx/docs/webhooks' },
  { label: 'Changelog', href: '/simplefx/docs/changelog' },
]

export default function DocsMobileNav() {
  const pathname = usePathname()

  return (
    <div className="lg:hidden border-b border-white/5 overflow-x-auto">
      <div className="flex gap-1 px-6 py-2 min-w-max">
        {TABS.map((tab) => {
          const active = pathname === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`text-xs px-3 py-1.5 rounded transition-all duration-150 whitespace-nowrap ${
                active
                  ? 'text-white bg-white/8 border border-white/10'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
