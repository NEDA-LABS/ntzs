export default function ActivityLoading() {
  return (
    <div className="p-6 animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-5 w-32 rounded bg-white/5" />
        <div className="h-3 w-48 rounded bg-white/5" />
      </div>
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-white/5" />
              <div className="space-y-1.5">
                <div className="h-3 w-28 rounded bg-white/5" />
                <div className="h-2.5 w-20 rounded bg-white/5" />
              </div>
            </div>
            <div className="space-y-1.5 text-right">
              <div className="h-3 w-20 rounded bg-white/5 ml-auto" />
              <div className="h-2.5 w-12 rounded bg-white/5 ml-auto" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
