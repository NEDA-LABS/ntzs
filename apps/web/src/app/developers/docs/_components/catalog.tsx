import type { ReactNode } from 'react'
import { CAPABILITIES, ALL_CAPABILITIES, type Capability } from '@/lib/platform/capabilities'

/** Minimal line icons per capability (kept here so docs stay registry-driven). */
const ICON_PATHS: Record<Capability, ReactNode> = {
  wallets: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 14h2" /></>,
  collections: <><path d="M12 4v11M7 11l5 5 5-5" /><path d="M5 20h14" /></>,
  disbursements: <><path d="M12 20V9M7 13l5-5 5 5" /><path d="M5 4h14" /></>,
  transfers: <><path d="M16 4l4 4-4 4M20 8H8M8 20l-4-4 4-4M4 16h12" /></>,
  treasury: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /></>,
  swap: <><path d="M17 4l3 3-3 3M20 7H9M7 14l-3 3 3 3M4 17h11" /></>,
  ramp: <><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></>,
}

export function CapIcon({ id, className }: { id: Capability; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[id]}
    </svg>
  )
}

export function CapChip({ id }: { id: Capability }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70">
      <CapIcon id={id} className="h-3 w-3 text-white/45" />
      {CAPABILITIES[id].label}
    </span>
  )
}

export const DOC_CAPS = ALL_CAPABILITIES.map((id) => ({
  id,
  label: CAPABILITIES[id].label,
  description: CAPABILITIES[id].description,
  kybRequired: CAPABILITIES[id].kybRequired,
  href: `/developers/docs/${CAPABILITIES[id].docsSlug}`,
  live: id === 'ramp', // only Ramp has a written reference today
}))

/** Use cases = compositions of capabilities. This is the story. */
export const USE_CASES: { name: string; caps: Capability[]; blurb: string }[] = [
  { name: 'Insurance · T+0 collections', caps: ['collections', 'treasury'], blurb: 'Sweep premiums in real time from every mobile network and bank straight into treasury.' },
  { name: 'Payroll & contractor payouts', caps: ['disbursements', 'treasury'], blurb: 'Pay hundreds of people in a single run — mobile money or bank.' },
  { name: 'Stablecoin settlement', caps: ['ramp'], blurb: 'USDC ⇄ mobile money with no end-user wallets — built for fintechs and PSPs.' },
  { name: 'Neobank / fintech', caps: ['wallets', 'collections', 'disbursements', 'transfers', 'swap'], blurb: 'A full money stack: issue wallets, collect, pay out, move value, and convert.' },
]

/** Consistent story header for a single capability's docs page. */
export function CapabilityHeader({ id }: { id: Capability }) {
  const def = CAPABILITIES[id]
  const powers = USE_CASES.filter((u) => u.caps.includes(id))
  return (
    <header className="border-b border-white/10 pb-7">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-indigo-500/15 to-violet-500/5 text-indigo-200">
          <CapIcon id={id} className="h-5 w-5" />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{def.label}</h1>
            {def.kybRequired && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">KYB required</span>}
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-widest text-white/30">Capability</p>
        </div>
      </div>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/55">{def.description}</p>
      {powers.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-white/35">
          <span className="uppercase tracking-wider">Powers</span>
          {powers.map((u) => <span key={u.name} className="rounded-md bg-white/5 px-2 py-0.5 text-white/55">{u.name}</span>)}
        </div>
      )}
    </header>
  )
}
