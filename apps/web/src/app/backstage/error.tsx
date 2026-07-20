'use client'

/**
 * Backstage-wide error boundary: an uncaught error in a page render or a
 * server action lands here — inside the layout, recoverable — instead of the
 * full-screen "Application error" page. The failing write was already rolled
 * back or refused server-side; this is purely presentation.
 */
export default function BackstageError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const showMessage = error.message && !/server-side exception/i.test(error.message)
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="w-full max-w-lg rounded-2xl border border-rose-500/30 bg-rose-500/5 p-8 text-center">
        <h2 className="text-lg font-semibold text-white">This tab hit an error</h2>
        <p className="mt-2 text-sm text-zinc-400">
          The rest of Backstage is unaffected and no partial changes were committed.
          {error.digest ? (
            <>
              {' '}
              Log reference: <code className="text-zinc-300">{error.digest}</code>
            </>
          ) : null}
        </p>
        {showMessage ? (
          <p className="mt-3 rounded-lg bg-black/40 p-3 text-left font-mono text-xs text-rose-300">{error.message}</p>
        ) : null}
        <div className="mt-5 flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20"
          >
            Try again
          </button>
          <a
            href="/backstage/activity"
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5"
          >
            Open Activity &amp; Logs
          </a>
        </div>
      </div>
    </div>
  )
}
