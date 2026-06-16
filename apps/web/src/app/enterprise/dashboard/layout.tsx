'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

type AccountType = 'capital_lender' | 'disbursement_client'

interface EnterpriseAccount {
  id: string
  name: string
  email: string
  type: AccountType
  partnerId: string | null
}

const lenderNav = [
  { href: '/enterprise/dashboard', label: 'Overview', icon: '▪' },
  { href: '/enterprise/dashboard/wallet', label: 'Wallet', icon: '▪' },
  { href: '/enterprise/dashboard/merchants', label: 'Merchants', icon: '▪' },
  { href: '/enterprise/dashboard/invitations', label: 'Invitations', icon: '▪' },
  { href: '/enterprise/dashboard/repayments', label: 'Repayments', icon: '▪' },
  { href: '/enterprise/dashboard/loans', label: 'Loan Agreements', icon: '▪' },
]

const disbursementNav = [
  { href: '/enterprise/dashboard', label: 'Overview', icon: '▪' },
  { href: '/enterprise/dashboard/wallet', label: 'Wallet', icon: '▪' },
  { href: '/enterprise/dashboard/disbursements', label: 'Disbursements', icon: '▪' },
  { href: '/enterprise/dashboard/disbursements/recipients', label: 'Recipients', icon: '▪' },
  { href: '/enterprise/dashboard/disbursements/new', label: 'New Batch', icon: '+' },
]

export default function EnterpriseDashboardLayout({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<EnterpriseAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    fetch('/enterprise/api/auth/me')
      .then(r => {
        if (r.status === 401) { router.replace('/enterprise/login'); return null }
        return r.json()
      })
      .then(data => { if (data) setAccount(data) })
      .finally(() => setLoading(false))
  }, [router])

  async function handleLogout() {
    await fetch('/enterprise/api/auth/logout', { method: 'POST' })
    router.push('/enterprise/login')
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white font-mono">
        <p className="text-[10px] tracking-widest text-gray-400 uppercase animate-pulse">Loading...</p>
      </div>
    )
  }

  if (!account) return null

  const nav = account.type === 'capital_lender' ? lenderNav : disbursementNav
  const typeLabel = account.type === 'capital_lender' ? 'Capital Lender' : 'Disbursement Client'

  return (
    <div className="flex min-h-screen bg-white font-mono text-gray-700">
      {/* Sidebar — stays dark */}
      <aside className="w-56 shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold tracking-[0.3em] text-slate-100 uppercase">
              n<span className="text-indigo-400">TZS</span>
            </span>
            <div className="w-px h-3 bg-slate-700" />
            <span className="text-[10px] tracking-[0.2em] text-slate-600 uppercase">Enterprise</span>
          </div>
          <p className="text-[10px] text-indigo-400 tracking-wider truncate">{account.name}</p>
          <p className="text-[10px] text-slate-500 tracking-wide mt-0.5">{typeLabel}</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {nav.map(item => {
            const active = item.href === '/enterprise/dashboard'
              ? pathname === item.href
              : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 text-[11px] tracking-widest uppercase transition-colors ${
                  active
                    ? 'text-indigo-400 bg-indigo-950 border-l-2 border-indigo-500'
                    : 'text-slate-500 hover:text-slate-200 hover:bg-slate-900 border-l-2 border-transparent'
                }`}
              >
                <span className="text-[8px]">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-slate-800 space-y-0.5">
          <p className="px-3 text-[10px] text-slate-600 truncate">{account.email}</p>
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 text-[10px] tracking-widest text-slate-600 uppercase hover:text-slate-300 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-slate-50">
        {children}
      </main>
    </div>
  )
}
