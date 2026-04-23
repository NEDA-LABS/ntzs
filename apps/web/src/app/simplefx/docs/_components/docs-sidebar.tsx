'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  {
    group: 'General',
    items: [
      { label: 'Overview', href: '/simplefx/docs/overview' },
      { label: 'Getting Started', href: '/simplefx/docs/overview#getting-started' },
      { label: 'Supported Assets', href: '/simplefx/docs/overview#assets' },
      { label: 'How Spreads Work', href: '/simplefx/docs/overview#spreads' },
    ],
  },
  {
    group: 'Market Maker API',
    items: [
      { label: 'Authentication', href: '/simplefx/docs/api-reference#authentication' },
      { label: 'Account', href: '/simplefx/docs/api-reference#account' },
      { label: 'Balances', href: '/simplefx/docs/api-reference#balances' },
      { label: 'Rate & Quote', href: '/simplefx/docs/api-reference#rate' },
      { label: 'Spread', href: '/simplefx/docs/api-reference#spread' },
      { label: 'Activate', href: '/simplefx/docs/api-reference#activate' },
      { label: 'Fills', href: '/simplefx/docs/api-reference#fills' },
      { label: 'Withdraw', href: '/simplefx/docs/api-reference#withdraw' },
      { label: 'Errors', href: '/simplefx/docs/api-reference#errors' },
    ],
  },
  {
    group: 'Webhooks',
    items: [
      { label: 'Overview', href: '/simplefx/docs/webhooks' },
      { label: 'Event Reference', href: '/simplefx/docs/webhooks#events' },
    ],
  },
  {
    group: 'More',
    items: [
      { label: 'Changelog', href: '/simplefx/docs/changelog' },
      { label: 'Support', href: 'mailto:devops@ntzs.co.tz' },
    ],
  },
]

export default function DocsSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:block w-48 shrink-0 sticky top-20 self-start max-h-[calc(100vh-5rem)] overflow-y-auto fx-fade-up">
      <div className="mb-5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 border border-white/5 px-2 py-1 rounded">
          API v1
        </span>
      </div>

      <nav className="space-y-5">
        {NAV.map((section) => (
          <div key={section.group}>
            <p className="text-[9px] uppercase tracking-[0.22em] text-zinc-600 font-medium mb-1.5 px-2">
              {section.group}
            </p>
            <ul className="space-y-px">
              {section.items.map((item) => {
                const base = item.href.split('#')[0]
                const active = pathname === base
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`block text-xs px-2 py-1.5 rounded transition-all duration-150 ${
                        active
                          ? 'text-white bg-white/5 border-l-2 border-blue-500 pl-[6px]'
                          : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03] border-l-2 border-transparent'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
