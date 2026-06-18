import type { ReactNode } from 'react'

export function H1({ children }: { children: ReactNode }) {
  return <h1 className="text-3xl font-bold tracking-tight">{children}</h1>
}
export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-base leading-relaxed text-white/55">{children}</p>
}
export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-10 mb-3 text-lg font-semibold">{children}</h2>
}
export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-white/65">{children}</p>
}
export function Endpoint({ method, path }: { method: string; path: string }) {
  const color = method === 'GET' ? 'text-sky-300 bg-sky-500/10' : 'text-emerald-300 bg-emerald-500/10'
  return (
    <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-xs">
      <span className={`rounded px-1.5 py-0.5 font-semibold ${color}`}>{method}</span>
      <span className="text-white/70">{path}</span>
    </div>
  )
}
export function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-4 text-xs leading-relaxed text-white/80">
      <code>{children}</code>
    </pre>
  )
}
