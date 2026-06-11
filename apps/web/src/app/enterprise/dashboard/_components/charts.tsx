'use client'

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

function fmtCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(Math.round(n))
}

/** Month label like "2024-03" → "Mar" */
function monthLabel(ym: string): string {
  const [, m] = ym.split('-')
  const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return names[Number(m)] ?? ym
}

/**
 * Monthly repayment inflow as a hand-rolled SVG bar chart (no chart dependency).
 */
export function RepaymentTrendChart({ data }: { data: Array<{ month: string; totalTzs: number; count: number }> }) {
  if (!data.length) {
    return <p className="text-xs text-gray-400 py-8 text-center">No repayments in the last 12 months.</p>
  }

  const W = 640
  const H = 160
  const padX = 8
  const padBottom = 22
  const padTop = 12
  const max = Math.max(...data.map((d) => d.totalTzs), 1)
  const slot = (W - padX * 2) / data.length
  const barW = Math.min(slot * 0.6, 36)

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: data.length * 36 }} role="img" aria-label="Monthly repayment inflow">
        {/* baseline */}
        <line x1={padX} y1={H - padBottom} x2={W - padX} y2={H - padBottom} stroke="#e5e7eb" strokeWidth="1" />
        {data.map((d, i) => {
          const h = ((d.totalTzs / max) * (H - padBottom - padTop))
          const x = padX + i * slot + (slot - barW) / 2
          const y = H - padBottom - h
          return (
            <g key={d.month}>
              <rect x={x} y={y} width={barW} height={Math.max(h, 1)} rx={2} fill="#6366f1" className="transition-all">
                <title>{`${monthLabel(d.month)} ${d.month.split('-')[0]} · TZS ${fmt(d.totalTzs)} · ${d.count} repayment${d.count === 1 ? '' : 's'}`}</title>
              </rect>
              <text x={x + barW / 2} y={y - 3} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 8 }}>
                {fmtCompact(d.totalTzs)}
              </text>
              <text x={x + barW / 2} y={H - padBottom + 12} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 8 }}>
                {monthLabel(d.month)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

interface Aging {
  current: number
  dueSoon: number
  overdue: number
  severelyOverdue: number
}

const AGING_SEGMENTS: Array<{ key: keyof Aging; label: string; color: string; text: string }> = [
  { key: 'current',         label: 'Current',          color: '#10b981', text: 'text-emerald-600' },
  { key: 'dueSoon',         label: 'Due ≤ 7d',         color: '#f59e0b', text: 'text-amber-600' },
  { key: 'overdue',         label: 'Overdue',          color: '#f97316', text: 'text-orange-600' },
  { key: 'severelyOverdue', label: 'Overdue 30d+',     color: '#ef4444', text: 'text-red-600' },
]

/**
 * Capital-at-risk aging as a segmented horizontal bar + legend.
 */
export function AgingBar({ aging }: { aging: Aging }) {
  const total = AGING_SEGMENTS.reduce((s, seg) => s + aging[seg.key], 0)

  if (total === 0) {
    return <p className="text-xs text-gray-400 py-4">No outstanding capital to age yet.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
        {AGING_SEGMENTS.map((seg) => {
          const v = aging[seg.key]
          if (v <= 0) return null
          return (
            <div
              key={seg.key}
              style={{ width: `${(v / total) * 100}%`, backgroundColor: seg.color }}
              className="h-full first:rounded-l-full last:rounded-r-full"
              title={`${seg.label}: TZS ${fmt(v)}`}
            />
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {AGING_SEGMENTS.map((seg) => (
          <div key={seg.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seg.color }} />
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-wider text-gray-400 truncate">{seg.label}</p>
              <p className={`text-[11px] font-semibold tabular-nums ${seg.text}`}>TZS {fmt(aging[seg.key])}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
