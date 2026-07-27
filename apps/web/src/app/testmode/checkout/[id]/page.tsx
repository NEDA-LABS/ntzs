import Link from 'next/link'

export const dynamic = 'force-dynamic'

/**
 * Stand-in for the hosted card-payment page in test mode.
 *
 * A card deposit returns a `paymentUrl` that the partner redirects the user
 * to. In production that is the PSP's hosted page; here it is this page, so
 * the redirect in a partner's integration is exercised end-to-end instead of
 * landing on a 404. No card is collected and nothing is charged — the deposit
 * settles on its own, exactly like every other test-mode transaction.
 */
export default async function TestModeCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-8">
        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-amber-300">
          Test mode
        </span>

        <h1 className="mt-5 text-xl font-semibold text-white">Simulated card checkout</h1>

        <p className="mt-3 text-sm leading-relaxed text-white/60">
          In production this is the payment provider&apos;s hosted card page. In test mode nothing is collected
          and nothing is charged — the deposit settles by itself a few seconds after it was created.
        </p>

        <dl className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
          <dt className="text-xs uppercase tracking-wide text-white/40">Deposit</dt>
          <dd className="mt-1 break-all font-mono text-white/80">{id}</dd>
        </dl>

        <p className="mt-6 text-sm text-white/60">
          Poll <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">GET /api/v1/deposits/{id}</code> until it
          reports <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">minted</code>, or settle it right now
          with <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">POST /api/v1/testmode/advance</code>.
        </p>

        <Link
          href="/developers#testmode"
          className="mt-7 inline-block rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10"
        >
          Test mode documentation
        </Link>
      </div>
    </div>
  )
}
