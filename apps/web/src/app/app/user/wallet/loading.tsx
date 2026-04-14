export default function WalletLoading() {
  return (
    <div className="ntzs-wallet-shell animate-pulse px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-[32px] border border-border/40 bg-card/70 p-6 shadow-[0_30px_90px_rgba(3,7,18,0.32)] backdrop-blur-2xl md:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-5">
              <div className="h-7 w-36 rounded-full bg-white/5" />
              <div className="space-y-3">
                <div className="h-4 w-32 rounded bg-white/5" />
                <div className="h-10 w-64 rounded bg-white/5" />
                <div className="h-4 w-full max-w-xl rounded bg-white/5" />
                <div className="h-4 w-4/5 max-w-lg rounded bg-white/5" />
              </div>
              <div className="flex gap-3">
                <div className="h-12 w-36 rounded-full bg-white/5" />
                <div className="h-12 w-36 rounded-full bg-white/5" />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="h-24 rounded-3xl bg-white/5" />
                <div className="h-24 rounded-3xl bg-white/5" />
                <div className="h-24 rounded-3xl bg-white/5" />
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-[28px] border border-border/40 bg-background/40 p-6 backdrop-blur-2xl">
                <div className="h-4 w-28 rounded bg-white/5" />
                <div className="mt-3 h-8 w-44 rounded bg-white/5" />
                <div className="mt-2 h-4 w-56 rounded bg-white/5" />
                <div className="mt-8 h-12 w-44 rounded-full bg-white/5" />
                <div className="mt-6 h-16 w-full rounded-3xl bg-white/5" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="h-28 rounded-3xl bg-white/5" />
                <div className="h-28 rounded-3xl bg-white/5" />
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="h-[320px] rounded-[32px] border border-border/40 bg-card/70 backdrop-blur-2xl" />
            <div className="h-[320px] rounded-[32px] border border-border/40 bg-card/70 backdrop-blur-2xl" />
          </div>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
              <div className="h-32 rounded-[28px] border border-border/40 bg-card/70 backdrop-blur-2xl" />
              <div className="h-32 rounded-[28px] border border-border/40 bg-card/70 backdrop-blur-2xl" />
            </div>
            <div className="h-32 rounded-[28px] border border-border/40 bg-card/70 backdrop-blur-2xl" />
          </div>
        </div>
      </div>
    </div>
  )
}
