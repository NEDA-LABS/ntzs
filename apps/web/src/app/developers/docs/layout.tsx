import Link from 'next/link'
import { DocsSidebar } from './_components/sidebar'

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#060609] text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#060609]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/developers/docs" className="text-sm font-semibold">nTZS <span className="text-white/40">Developer Docs</span></Link>
          <Link href="/developers/dashboard" className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">Dashboard →</Link>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-10 px-6 py-10">
        <aside className="hidden w-56 shrink-0 lg:block"><div className="sticky top-20"><DocsSidebar /></div></aside>
        <main className="min-w-0 flex-1">
          <article className="prose-docs max-w-none">{children}</article>
        </main>
      </div>
    </div>
  )
}
