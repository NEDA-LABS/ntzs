export default function WalletLoading() {
  return (
    <div className="px-4 py-5 lg:p-8 animate-pulse">
      <div className="mx-auto max-w-lg">
        <div className="mb-6">
          <div className="h-5 w-32 rounded bg-white/5" />
          <div className="mt-2 h-3 w-48 rounded bg-white/5" />
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-6">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <div className="h-[184px] w-[184px] rounded-2xl bg-white/5" />
            <div className="flex-1 space-y-4 w-full">
              <div className="h-3 w-24 rounded bg-white/5" />
              <div className="h-4 w-full rounded bg-white/5" />
              <div className="h-10 w-32 rounded-xl bg-white/5" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="h-16 rounded-xl bg-white/5" />
            <div className="h-16 rounded-xl bg-white/5" />
            <div className="h-16 rounded-xl bg-white/5" />
          </div>
        </div>
      </div>
    </div>
  )
}
