import Link from 'next/link'
import { DOC_CAPS, USE_CASES, CapIcon, CapChip } from './_components/catalog'

export default function DocsOverview() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-blue-900/25 via-[#0a0a16] to-violet-900/20 p-8 sm:p-10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-indigo-500/10 blur-3xl" />
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-indigo-300/70">nTZS Developer Platform</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
          Composable money APIs<br /><span className="text-white/45">for Tanzania.</span>
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-white/55">
          Don&apos;t adopt a product — compose <strong className="text-white/80">capabilities</strong>. Collect from mobile money and
          banks, disburse to phones, hold treasury, swap USDC ⇄ nTZS, or settle wallet-less. One key, one set of webhooks.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/developers/docs/authentication" className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90">Start with authentication</Link>
          <Link href="/developers/docs/ramp" className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/10">Explore Ramp →</Link>
        </div>
      </section>

      {/* Primitives */}
      <section>
        <div className="mb-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/35">The primitives</p>
          <h2 className="mt-1.5 text-xl font-bold">Pick the capabilities you need</h2>
          <p className="mt-1 text-sm text-white/45">Enable only what you use. Money-moving capabilities require approved KYB.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DOC_CAPS.map((c) => {
            const inner = (
              <div className={`group h-full rounded-2xl border p-5 transition-colors ${c.live ? 'border-white/10 bg-white/[0.02] hover:border-white/25' : 'border-white/5 bg-white/[0.01]'}`}>
                <div className="flex items-start justify-between">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${c.live ? 'border-indigo-400/20 bg-indigo-500/10 text-indigo-200' : 'border-white/10 bg-white/[0.03] text-white/40'}`}>
                    <CapIcon id={c.id} className="h-5 w-5" />
                  </span>
                  {c.kybRequired && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-300">KYB</span>}
                </div>
                <p className="mt-4 font-semibold">{c.label}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-white/45">{c.description}</p>
                <p className={`mt-4 text-xs font-medium ${c.live ? 'text-indigo-300 group-hover:text-indigo-200' : 'text-white/25'}`}>{c.live ? 'Read the docs →' : 'Reference coming soon'}</p>
              </div>
            )
            return c.live ? <Link key={c.id} href={c.href} className="block">{inner}</Link> : <div key={c.id}>{inner}</div>
          })}
        </div>
      </section>

      {/* Compose your use case */}
      <section>
        <div className="mb-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/35">Compose your use case</p>
          <h2 className="mt-1.5 text-xl font-bold">Recipes, not products</h2>
          <p className="mt-1 text-sm text-white/45">The same primitives combine into whatever you&apos;re building.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {USE_CASES.map((u) => (
            <div key={u.name} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <p className="font-semibold">{u.name}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-white/45">{u.blurb}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {u.caps.map((id, i) => (
                  <span key={id} className="flex items-center gap-2">
                    {i > 0 && <span className="text-white/20">+</span>}
                    <CapChip id={id} />
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Start */}
      <section>
        <div className="mb-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/35">Get started</p>
          <h2 className="mt-1.5 text-xl font-bold">Live in three steps</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { n: '01', t: 'Get your API key', d: 'Sign in and grab your Bearer key from the dashboard.', href: '/developers/docs/authentication' },
            { n: '02', t: 'Enable capabilities', d: 'Pick the capabilities your use case needs — request access where required.', href: '/developers/dashboard' },
            { n: '03', t: 'Call the API', d: 'Quote, settle, collect, disburse — with idempotency + webhooks.', href: '/developers/docs/ramp' },
          ].map((s) => (
            <Link key={s.n} href={s.href} className="group rounded-2xl border border-white/10 bg-white/[0.02] p-5 transition-colors hover:border-white/25">
              <p className="font-mono text-sm text-indigo-300/70">{s.n}</p>
              <p className="mt-2 font-semibold">{s.t}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-white/45">{s.d}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
