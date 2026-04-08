import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import DocsSidebar from './_components/docs-sidebar'
import DocsMobileNav from './_components/docs-mobile-nav'

export const metadata = {
  title: 'Documentation — SimpleFX',
  description: 'Developer and LP documentation for SimpleFX, the open TZS liquidity market.',
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Top nav */}
      <div className="sticky top-0 z-20 border-b border-white/5 bg-black/90 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/simplefx"
            className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-white transition-colors duration-150"
          >
            <ArrowLeft size={13} />
            SimpleFX
          </Link>
          <div className="flex items-center gap-4 text-xs text-zinc-600">
            <Link href="/simplefx/terms" className="hover:text-zinc-300 transition-colors duration-150">Terms</Link>
            <Link href="/simplefx/privacy" className="hover:text-zinc-300 transition-colors duration-150">Privacy</Link>
          </div>
        </div>
      </div>

      {/* Mobile tabs */}
      <DocsMobileNav />

      {/* Body */}
      <div className="max-w-6xl mx-auto px-6 flex gap-14 py-12">
        <DocsSidebar />
        <main className="flex-1 min-w-0 max-w-3xl">
          {children}
        </main>
      </div>

      {/* Footer */}
      <div className="border-t border-white/5 mt-16">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-700">
          <span>NEDA Labs Ltd. — Dar es Salaam, Tanzania</span>
          <div className="flex gap-4">
            <Link href="/simplefx/terms" className="hover:text-zinc-400 transition-colors">Terms</Link>
            <Link href="/simplefx/privacy" className="hover:text-zinc-400 transition-colors">Privacy</Link>
            <a href="mailto:support@nedapay.xyz" className="hover:text-zinc-400 transition-colors">Support</a>
          </div>
        </div>
      </div>
    </div>
  )
}
