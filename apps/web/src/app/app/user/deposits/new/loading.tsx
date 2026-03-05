export default function DepositNewLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="mx-auto max-w-lg space-y-5">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 space-y-5">
          {/* Amount skeleton */}
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <div className="h-3 w-10 rounded bg-white/5" />
            <div className="mt-3 h-12 w-40 rounded bg-white/5" />
            <div className="mt-3 flex gap-2">
              <div className="h-7 w-12 rounded-xl bg-white/5" />
              <div className="h-7 w-12 rounded-xl bg-white/5" />
              <div className="h-7 w-12 rounded-xl bg-white/5" />
            </div>
          </div>
          {/* Method selector skeleton */}
          <div>
            <div className="mb-2 h-3 w-16 rounded bg-white/5" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-16 rounded-2xl bg-white/5" />
              <div className="h-16 rounded-2xl bg-white/5" />
            </div>
          </div>
          {/* CTA skeleton */}
          <div className="h-14 rounded-2xl bg-white/5" />
        </div>
      </div>
    </div>
  )
}
