import Link from 'next/link'
import { H1, Lead, H2, P } from './_components/ui'

export default function DocsOverview() {
  return (
    <>
      <H1>nTZS Developer Platform</H1>
      <Lead>
        Composable financial primitives for Tanzania. Pick the capabilities your product needs —
        collect from mobile money, disburse to phones and banks, hold treasury, swap USDC ⇄ nTZS,
        or run wallet-less USDC ⇄ mobile-money settlement. One API key, one set of webhooks.
      </Lead>

      <H2>How it works</H2>
      <P>
        You don&apos;t adopt a rigid &quot;product&quot; — you enable <strong>capabilities</strong> and compose them for
        your use case. A few examples:
      </P>
      <ul className="mt-3 space-y-2 text-sm text-white/65">
        <li>• <strong>Insurance (T+0 collections):</strong> <code className="text-white/80">collections</code> + <code className="text-white/80">treasury</code></li>
        <li>• <strong>Payroll / contractor payouts:</strong> <code className="text-white/80">disbursements</code> + <code className="text-white/80">treasury</code></li>
        <li>• <strong>Stablecoin settlement:</strong> <code className="text-white/80">ramp</code></li>
        <li>• <strong>Neobank / fintech:</strong> <code className="text-white/80">wallets</code> + <code className="text-white/80">collections</code> + <code className="text-white/80">disbursements</code> + <code className="text-white/80">transfers</code> + <code className="text-white/80">swap</code></li>
      </ul>
      <P>
        Manage which capabilities are enabled — and request more — from your{' '}
        <Link href="/developers/dashboard" className="text-white underline">dashboard</Link>.
        Money-moving capabilities require approved KYB.
      </P>

      <H2>Next steps</H2>
      <ul className="mt-3 space-y-2 text-sm text-white/65">
        <li>• <Link href="/developers/docs/authentication" className="text-white underline">Authentication</Link> — get your API key and call the API.</li>
        <li>• <Link href="/developers/docs/ramp" className="text-white underline">Ramp</Link> — wallet-less USDC ⇄ mobile-money settlement.</li>
      </ul>
    </>
  )
}
