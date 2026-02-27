import Link from 'next/link'

interface CardReturnPageProps {
  searchParams: { status?: string; deposit?: string }
}

export default function CardReturnPage({ searchParams }: CardReturnPageProps) {
  const { status, deposit } = searchParams
  const isSuccess = status === 'success'

  return (
    <div className="p-8">
      <div className="mx-auto max-w-xl">
        <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-xl">
          {isSuccess ? (
            <>
              <div className="absolute inset-0 -z-10 rounded-3xl bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.15),transparent_50%)]" />
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
                  <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="mt-6 text-xl font-semibold text-white">Payment Received</h2>
                <p className="mt-2 text-zinc-400">
                  Your card payment was successful. Your nTZS will be minted and appear in your wallet shortly.
                </p>
                {deposit && (
                  <p className="mt-3 font-mono text-xs text-zinc-600">ref: {deposit}</p>
                )}
                <div className="mt-8 flex flex-col gap-3">
                  <Link
                    href="/app/user"
                    className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 px-6 py-4 text-center text-base font-semibold text-white shadow-lg shadow-violet-500/25 transition-all duration-75 active:scale-[0.98] hover:shadow-violet-500/40"
                  >
                    Go to Dashboard
                  </Link>
                  <Link
                    href="/app/user/activity"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-center text-base font-medium text-white transition-all duration-75 active:scale-[0.98] hover:bg-white/10"
                  >
                    View Activity
                  </Link>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="absolute inset-0 -z-10 rounded-3xl bg-[radial-gradient(circle_at_50%_0%,rgba(239,68,68,0.10),transparent_50%)]" />
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20">
                  <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h2 className="mt-6 text-xl font-semibold text-white">Payment Cancelled</h2>
                <p className="mt-2 text-zinc-400">
                  Your card payment was cancelled. No funds have been charged.
                </p>
                <div className="mt-8 flex flex-col gap-3">
                  <Link
                    href="/app/user/deposits/new"
                    className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 px-6 py-4 text-center text-base font-semibold text-white shadow-lg shadow-violet-500/25 transition-all duration-75 active:scale-[0.98] hover:shadow-violet-500/40"
                  >
                    Try Again
                  </Link>
                  <Link
                    href="/app/user"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-center text-base font-medium text-white transition-all duration-75 active:scale-[0.98] hover:bg-white/10"
                  >
                    Back to Dashboard
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
