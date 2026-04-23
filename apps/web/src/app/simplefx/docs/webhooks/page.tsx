import CodeBlock, { InlineCode } from '../_components/code-block'

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="mb-14 scroll-mt-24">
      <h2 className="text-base font-medium text-white mb-5 pb-2 border-b border-white/5">{title}</h2>
      {children}
    </div>
  )
}

export default function WebhooksPage() {
  return (
    <div>
      {/* Page header */}
      <div className="fx-fade-up mb-10 pb-8 border-b border-white/5">
        <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-600 mb-3">Documentation</p>
        <h1 className="text-3xl font-thin text-white mb-3">Webhooks</h1>
        <p className="text-zinc-500 text-sm leading-relaxed max-w-xl">
          Receive real-time HTTP notifications when events occur on your LP position — fills,
          withdrawals, and activation changes.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 text-xs text-amber-400 bg-amber-400/8 border border-amber-400/20 px-3 py-1.5 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          Webhooks are on the roadmap. Configure your endpoint URL now in Settings to be ready.
        </div>
        <p className="text-xs text-zinc-700 mt-4">Last updated: 8 April 2026</p>
      </div>

      {/* Overview */}
      <Section id="overview" title="Overview">
        <div className="fx-fade-up fx-delay-1 space-y-4 text-sm text-zinc-500 leading-relaxed">
          <p>
            When an event occurs, SimpleFX sends an HTTP <InlineCode>POST</InlineCode> request to
            your configured webhook URL with a JSON body describing the event. Your endpoint must
            respond with a <InlineCode>2xx</InlineCode> status code within 10 seconds to acknowledge
            receipt.
          </p>
          <p>
            Failed deliveries are retried up to 5 times with exponential backoff (1s, 5s, 30s,
            2min, 10min). After 5 failures the event is marked as undelivered and logged in your
            dashboard.
          </p>
          <div className="rounded-lg border border-white/5 bg-white/[0.02] px-5 py-4 mt-2">
            <p className="text-xs font-medium text-zinc-300 mb-3">Webhook request headers</p>
            <table className="w-full text-xs border-collapse">
              <tbody className="divide-y divide-white/[0.04]">
                {[
                  ['X-SimpleFX-Event', 'Event type, e.g. fill.completed'],
                  ['X-SimpleFX-Signature', 'HMAC-SHA256 signature of the raw body using your webhook secret'],
                  ['X-SimpleFX-Timestamp', 'Unix timestamp (seconds) of the delivery attempt'],
                  ['Content-Type', 'application/json'],
                ].map(([h, v]) => (
                  <tr key={h}>
                    <td className="py-2 pr-4 font-mono text-zinc-400 text-[11px]">{h}</td>
                    <td className="py-2 text-zinc-600">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* Signature verification */}
      <Section id="verification" title="Signature Verification">
        <div className="fx-fade-up fx-delay-1 space-y-4 text-sm text-zinc-500 leading-relaxed">
          <p>
            Always verify the <InlineCode>X-SimpleFX-Signature</InlineCode> header before processing
            an event. This prevents attackers from spoofing webhook payloads.
          </p>
          <CodeBlock
            label="Verification — Node.js"
            lang="typescript"
            code={`import { createHmac } from 'crypto'

function verifyWebhook(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')
  return \`sha256=\${expected}\` === signature
}`}
          />
        </div>
      </Section>

      {/* Event reference */}
      <Section id="events" title="Event Reference">
        <div className="fx-fade-up fx-delay-1 space-y-8">

          {/* fill.completed */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[10px] font-mono font-semibold text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-1 rounded">
                fill.completed
              </span>
              <span className="text-xs text-zinc-600">Fired when a swap fills against your inventory</span>
            </div>
            <CodeBlock
              label="Payload"
              code={`{
  "event": "fill.completed",
  "lpId": "lp_01jqe...",
  "data": {
    "fillId": "fill_01jqe...",
    "fromToken": "USDC",
    "toToken": "NTZS",
    "amountIn": "10.000000",
    "amountOut": "37312.500000000000000000",
    "feesEarned": "37.312500000000000000",
    "inTxHash": "0xabc...",
    "outTxHash": "0xdef...",
    "timestamp": "2026-04-08T09:28:00Z"
  }
}`}
            />
          </div>

          {/* fill.failed */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[10px] font-mono font-semibold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded">
                fill.failed
              </span>
              <span className="text-xs text-zinc-600">Fired when a swap could not be filled (e.g. insufficient liquidity)</span>
            </div>
            <CodeBlock
              label="Payload"
              code={`{
  "event": "fill.failed",
  "lpId": "lp_01jqe...",
  "data": {
    "fromToken": "USDC",
    "toToken": "NTZS",
    "amountIn": "10.000000",
    "reason": "INSUFFICIENT_LIQUIDITY",
    "timestamp": "2026-04-08T09:29:00Z"
  }
}`}
            />
          </div>

          {/* position.activated / position.deactivated */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[10px] font-mono font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded">
                position.activated
              </span>
              <span className="text-[10px] font-mono font-semibold text-zinc-500 bg-white/5 border border-white/8 px-2 py-1 rounded ml-1">
                position.deactivated
              </span>
            </div>
            <CodeBlock
              label="Payload"
              code={`{
  "event": "position.activated",
  "lpId": "lp_01jqe...",
  "data": {
    "walletAddress": "0x723A3D...155aBe",
    "timestamp": "2026-04-08T09:30:00Z"
  }
}`}
            />
          </div>

          {/* withdrawal.confirmed */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[10px] font-mono font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded">
                withdrawal.confirmed
              </span>
              <span className="text-xs text-zinc-600">Fired when a withdrawal transaction is confirmed on-chain</span>
            </div>
            <CodeBlock
              label="Payload"
              code={`{
  "event": "withdrawal.confirmed",
  "lpId": "lp_01jqe...",
  "data": {
    "token": "ntzs",
    "amount": "500.000000000000000000",
    "toAddress": "0xRecipient...",
    "txHash": "0xghi...",
    "timestamp": "2026-04-08T09:35:00Z"
  }
}`}
            />
          </div>
        </div>
      </Section>

      {/* Setup */}
      <Section id="setup" title="Configure Your Endpoint">
        <div className="fx-fade-up fx-delay-1 space-y-4 text-sm text-zinc-500 leading-relaxed">
          <p>
            Go to <span className="text-zinc-300">SimpleFX Dashboard → Settings → Webhooks</span> and
            enter your HTTPS endpoint URL. A webhook secret will be generated — store it securely
            as your signing key for signature verification.
          </p>
          <p>
            Your endpoint must be publicly reachable over HTTPS. Self-signed certificates are not
            accepted. For local development, use a tunneling service such as{' '}
            <span className="text-zinc-300">ngrok</span> or{' '}
            <span className="text-zinc-300">cloudflared</span>.
          </p>
          <div className="rounded-lg border border-white/5 bg-white/[0.02] px-5 py-4 mt-2">
            <p className="text-xs font-medium text-zinc-300 mb-2">Checklist</p>
            <ul className="space-y-1.5 text-xs text-zinc-500 list-disc pl-4">
              <li>Endpoint is reachable via HTTPS with a valid certificate</li>
              <li>Returns <InlineCode>200</InlineCode> within 10 seconds</li>
              <li>Verifies the <InlineCode>X-SimpleFX-Signature</InlineCode> header before processing</li>
              <li>Handles duplicate deliveries idempotently (use <InlineCode>fillId</InlineCode> as dedup key)</li>
            </ul>
          </div>
        </div>
      </Section>
    </div>
  )
}
