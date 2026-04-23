interface CodeBlockProps {
  code: string
  label?: string
  lang?: string
}

export default function CodeBlock({ code, label, lang = 'json' }: CodeBlockProps) {
  return (
    <div className="rounded-lg border border-white/5 overflow-hidden my-4">
      {label && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-white/[0.02]">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">{label}</span>
          {lang && (
            <span className="ml-auto text-[10px] font-mono text-zinc-700">{lang}</span>
          )}
        </div>
      )}
      <pre className="bg-zinc-950/80 px-4 py-4 overflow-x-auto">
        <code className="text-xs font-mono text-zinc-300 leading-relaxed whitespace-pre">{code}</code>
      </pre>
    </div>
  )
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-xs font-mono bg-white/5 border border-white/8 text-zinc-300 px-1.5 py-0.5 rounded">
      {children}
    </code>
  )
}

interface EndpointBadgeProps {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-400 bg-green-500/10 border-green-500/20',
  POST: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  PATCH: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  DELETE: 'text-red-400 bg-red-500/10 border-red-500/20',
}

export function EndpointBadge({ method, path }: EndpointBadgeProps) {
  return (
    <div className="flex items-center gap-3 my-3">
      <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-1 rounded border ${METHOD_COLORS[method]}`}>
        {method}
      </span>
      <code className="text-sm font-mono text-zinc-300">{path}</code>
    </div>
  )
}
