export default function UserDashboardLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="mb-6">
        <div className="h-3 w-24 rounded bg-white/5" />
        <div className="mt-2 h-5 w-48 rounded bg-white/5" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Balance card skeleton */}
        <div className="lg:col-span-2 rounded-3xl border border-white/10 bg-white/[0.04] p-8">
          <div className="h-3 w-20 rounded bg-white/5" />
          <div className="mt-6 h-14 w-56 rounded bg-white/5" />
          <div className="mt-3 h-3 w-28 rounded bg-white/5" />
          <div className="mt-8 flex gap-3">
            <div className="h-12 flex-1 rounded-2xl bg-white/5" />
            <div className="h-12 flex-1 rounded-2xl bg-white/5" />
          </div>
        </div>

        {/* Side card skeleton */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 space-y-4">
          <div className="h-3 w-24 rounded bg-white/5" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="h-3 w-24 rounded bg-white/5" />
              <div className="h-3 w-16 rounded bg-white/5" />
            </div>
          ))}
        </div>

        {/* Recent activity skeleton */}
        <div className="lg:col-span-3 rounded-3xl border border-white/10 bg-white/[0.04] p-6 space-y-4">
          <div className="h-3 w-32 rounded bg-white/5" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-white/5" />
                <div className="space-y-1.5">
                  <div className="h-3 w-24 rounded bg-white/5" />
                  <div className="h-2.5 w-16 rounded bg-white/5" />
                </div>
              </div>
              <div className="h-3 w-20 rounded bg-white/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
