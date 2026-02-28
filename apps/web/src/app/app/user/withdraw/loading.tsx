export default function WithdrawLoading() {
  return (
    <div className="p-6 max-w-lg mx-auto animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-5 w-32 rounded bg-white/5" />
        <div className="h-3 w-56 rounded bg-white/5" />
      </div>
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 space-y-5">
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5 space-y-3">
          <div className="h-3 w-20 rounded bg-white/5" />
          <div className="h-12 w-40 rounded bg-white/5" />
        </div>
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-white/5" />
          <div className="h-12 rounded-2xl bg-white/5" />
        </div>
        <div className="h-14 rounded-2xl bg-white/5" />
      </div>
    </div>
  )
}
