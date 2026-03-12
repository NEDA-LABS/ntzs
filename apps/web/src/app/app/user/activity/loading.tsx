export default function ActivityLoading() {
  return (
    <div className="min-h-screen bg-[#0d0d14] px-4 pt-4 pb-24 lg:px-8 lg:pt-6 animate-pulse">
      {/* Header */}
      <div className="mb-5 space-y-1.5">
        <div className="h-5 w-24 rounded-lg bg-white/[0.06]" />
        <div className="h-3 w-32 rounded-lg bg-white/[0.04]" />
      </div>

      {/* Stats */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl bg-[#12121e] p-4 ring-1 ring-white/[0.06] space-y-2">
            <div className="h-2.5 w-14 rounded bg-white/[0.06]" />
            <div className="h-5 w-16 rounded bg-white/[0.06]" />
            <div className="h-2 w-8 rounded bg-white/[0.04]" />
          </div>
        ))}
      </div>

      {/* List */}
      <div className="rounded-2xl bg-[#12121e] ring-1 ring-white/[0.06] overflow-hidden">
        <div className="border-b border-white/[0.05] px-4 py-3 flex gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 w-16 rounded-full bg-white/[0.05]" />
          ))}
        </div>
        <div className="divide-y divide-white/[0.04]">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3.5">
                <div className="h-10 w-10 rounded-2xl bg-white/[0.05]" />
                <div className="space-y-1.5">
                  <div className="h-3.5 w-24 rounded bg-white/[0.06]" />
                  <div className="h-2.5 w-20 rounded bg-white/[0.04]" />
                </div>
              </div>
              <div className="space-y-1.5 text-right">
                <div className="h-3.5 w-24 rounded bg-white/[0.06] ml-auto" />
                <div className="h-4 w-14 rounded-full bg-white/[0.04] ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
