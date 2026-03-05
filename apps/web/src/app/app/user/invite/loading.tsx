export default function InviteLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="mb-6">
        <div className="h-5 w-32 rounded bg-white/5" />
        <div className="mt-2 h-3 w-48 rounded bg-white/5" />
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 space-y-4">
        <div className="h-12 rounded-2xl bg-white/5" />
        <div className="h-12 rounded-2xl bg-white/5" />
        <div className="h-14 rounded-2xl bg-white/5" />
      </div>
    </div>
  )
}
