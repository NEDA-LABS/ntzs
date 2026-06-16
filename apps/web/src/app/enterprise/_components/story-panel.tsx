// Shared "story" branding for the enterprise auth pages (sign-in + request
// access), so the headline/copy stays in one place. Warm light, split-screen.

function Eyebrow() {
  return (
    <div className="flex items-center gap-2.5 text-[11px] tracking-[0.25em] uppercase text-stone-500">
      <span>n<span className="font-semibold text-indigo-600">TZS</span></span>
      <span className="h-3 w-px bg-stone-300" />
      <span>Enterprise</span>
    </div>
  )
}

function ValueProp({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-3.5">
      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100">
        <svg className="h-3.5 w-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-semibold text-stone-900">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-stone-600">{body}</p>
      </div>
    </div>
  )
}

/** Entrance-animation keyframes shared by both auth pages. */
export function EnterpriseAuthStyles() {
  return (
    <style>{`
      @keyframes eRise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes eIn { from { opacity: 0; } to { opacity: 1; } }
      .e-rise-1 { animation: eRise 0.7s cubic-bezier(0.16,1,0.3,1) 0.05s both; }
      .e-rise-2 { animation: eRise 0.7s cubic-bezier(0.16,1,0.3,1) 0.18s both; }
      .e-rise-3 { animation: eRise 0.7s cubic-bezier(0.16,1,0.3,1) 0.30s both; }
      .e-fade   { animation: eIn 0.6s ease-out 0.1s both; }
    `}</style>
  )
}

/** Left narrative panel (desktop only). */
export function EnterpriseStoryAside() {
  return (
    <aside
      className="relative hidden lg:flex flex-col justify-between overflow-hidden px-14 py-12"
      style={{ background: 'linear-gradient(135deg, #FBF1E6 0%, #FBF8F3 46%, #EEEAFF 100%)' }}
    >
      <div aria-hidden className="pointer-events-none absolute -top-28 -right-24 h-96 w-96 rounded-full bg-indigo-300/30 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-16 h-80 w-80 rounded-full bg-amber-300/25 blur-3xl" />

      <div className="e-fade relative"><Eyebrow /></div>

      <div className="relative max-w-md">
        <h1 className="e-rise-1 text-[2.6rem] xl:text-5xl font-semibold tracking-tight leading-[1.08] text-stone-900">
          Capital <span className="text-indigo-600">in Motion.</span>
        </h1>
        <p className="e-rise-1 mt-3 text-lg font-medium text-stone-700">Move money with zero friction.</p>
        <p className="e-rise-2 mt-4 text-[15px] leading-relaxed text-stone-600">
          Programmable TZS for Tanzania&apos;s supply chain — capital that grows with every sale,
          and payouts that clear in one run.
        </p>

        <div className="e-rise-3 mt-10 space-y-5">
          <ValueProp title="For capital lenders" body="Deploy capital that repays itself from every sale — with proof you can audit." />
          <ValueProp title="For disbursement partners" body="Pay all your contractors in one batch — by mobile money or bank." />
        </div>
      </div>

      <p className="e-fade relative text-xs text-stone-400">Settled in TZS · Audit-ready by default</p>
    </aside>
  )
}

/** Compact brand header shown on mobile, where the aside is hidden. */
export function EnterpriseMobileBrand() {
  return (
    <div className="lg:hidden mb-8">
      <Eyebrow />
      <h1 className="mt-4 text-3xl font-semibold tracking-tight leading-tight text-stone-900">
        Capital <span className="text-indigo-600">in Motion.</span>
      </h1>
      <p className="mt-2 text-sm font-medium text-stone-600">Move money with zero friction.</p>
    </div>
  )
}
