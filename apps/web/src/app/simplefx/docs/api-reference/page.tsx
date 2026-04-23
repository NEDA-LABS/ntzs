import CodeBlock, { InlineCode, EndpointBadge } from '../_components/code-block'

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="mb-14 scroll-mt-24">
      <h2 className="text-base font-medium text-white mb-5 pb-2 border-b border-white/5">{title}</h2>
      {children}
    </div>
  )
}

function ParamRow({ name, type, required, desc }: { name: string; type: string; required?: boolean; desc: string }) {
  return (
    <tr className="border-b border-white/[0.04] last:border-0">
      <td className="py-2.5 pr-4 align-top">
        <InlineCode>{name}</InlineCode>
        {required && <span className="ml-1.5 text-[9px] uppercase tracking-wider text-red-400/70">required</span>}
      </td>
      <td className="py-2.5 pr-4 align-top font-mono text-[11px] text-zinc-600">{type}</td>
      <td className="py-2.5 text-xs text-zinc-500 align-top">{desc}</td>
    </tr>
  )
}

export default function ApiReferencePage() {
  return (
    <div>
      {/* Page header */}
      <div className="fx-fade-up mb-10 pb-8 border-b border-white/5">
        <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-600 mb-3">Documentation</p>
        <h1 className="text-3xl font-thin text-white mb-3">Market Maker API</h1>
        <p className="text-zinc-500 text-sm leading-relaxed max-w-xl">
          Programmatic access to all LP functions. Use the API to automate inventory management,
          configure spreads, monitor fills, and withdraw earnings without the web dashboard.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 text-xs text-amber-400 bg-amber-400/8 border border-amber-400/20 px-3 py-1.5 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          API key auth is coming soon. All endpoints are currently available via the web dashboard.
        </div>
        <p className="text-xs text-zinc-700 mt-4">Last updated: 8 April 2026</p>
      </div>

      {/* Base URL */}
      <div className="fx-fade-up fx-delay-1 mb-10">
        <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">Base URL</p>
        <CodeBlock code="https://simplefx.io/api/v1/mm" />
      </div>

      {/* Authentication */}
      <Section id="authentication" title="Authentication">
        <div className="space-y-4 text-sm text-zinc-500 leading-relaxed fx-fade-up fx-delay-1">
          <p>
            All requests must include your LP API key in the <InlineCode>Authorization</InlineCode> header.
            API keys are issued from the SimpleFX dashboard under Settings.
          </p>
          <CodeBlock
            label="Request header"
            code={`Authorization: Bearer mm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}
          />
          <p>Keys are prefixed <InlineCode>mm_live_</InlineCode> for production and <InlineCode>mm_test_</InlineCode> for sandbox.</p>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-white/8">
                  <th className="text-left py-2 pr-6 text-zinc-600 font-medium">HTTP status</th>
                  <th className="text-left py-2 text-zinc-600 font-medium">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['401', 'Missing or invalid API key'],
                  ['403', 'Key is valid but does not have permission for this resource'],
                  ['429', 'Rate limit exceeded (60 req/min per key)'],
                ].map(([code, msg]) => (
                  <tr key={code} className="border-b border-white/[0.04]">
                    <td className="py-2.5 pr-6 font-mono text-zinc-300">{code}</td>
                    <td className="py-2.5 text-zinc-500">{msg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* Account */}
      <Section id="account" title="Account">
        <div className="fx-fade-up fx-delay-1 space-y-4">
          <p className="text-sm text-zinc-500">Returns the authenticated LP account profile and status.</p>
          <EndpointBadge method="GET" path="/api/v1/mm/account" />
          <CodeBlock
            label="Response"
            code={`{
  "id": "lp_01jqe...",
  "email": "mm@example.com",
  "walletAddress": "0x723A3D...155aBe",
  "isActive": true,
  "createdAt": "2026-01-15T10:00:00Z"
}`}
          />
        </div>
      </Section>

      {/* Balances */}
      <Section id="balances" title="Balances">
        <div className="fx-fade-up fx-delay-1 space-y-4">
          <p className="text-sm text-zinc-500">Returns current inventory balances for the LP wallet.</p>
          <EndpointBadge method="GET" path="/api/v1/mm/balances" />
          <CodeBlock
            label="Response"
            code={`{
  "ntzs": "9452.000000000000000000",
  "usdc": "3.912500",
  "wallet": {
    "address": "0x723A3D...155aBe",
    "chain": "base"
  }
}`}
          />
          <p className="text-xs text-zinc-600">
            When the position is active, <InlineCode>ntzs</InlineCode> reflects the DB-tracked pool
            position. When inactive it reflects the raw on-chain wallet balance.
          </p>
        </div>
      </Section>

      {/* Rate & Quote */}
      <Section id="rate" title="Rate & Quote">
        <div className="fx-fade-up fx-delay-1 space-y-6">
          <div>
            <p className="text-sm text-zinc-500 mb-3">Returns the current oracle mid-market rate (TZS per USDC).</p>
            <EndpointBadge method="GET" path="/api/v1/mm/rate" />
            <CodeBlock
              label="Response"
              code={`{
  "midRateTZS": 3750
}`}
            />
          </div>
          <div>
            <p className="text-sm text-zinc-500 mb-3">
              Returns a quote for a specific swap amount with the LP spread applied.
            </p>
            <EndpointBadge method="GET" path="/api/v1/mm/quote" />
            <p className="text-xs text-zinc-600 mb-3">Query parameters:</p>
            <table className="w-full text-xs border-collapse mb-3">
              <tbody>
                <ParamRow name="fromToken" type="string" required desc="NTZS or USDC" />
                <ParamRow name="toToken" type="string" required desc="NTZS or USDC" />
                <ParamRow name="amount" type="number" required desc="Input amount (human-readable, not wei)" />
                <ParamRow name="slippageBps" type="number" desc="Slippage tolerance in bps. Default: 100" />
              </tbody>
            </table>
            <CodeBlock
              label="Example — GET /api/v1/mm/quote?fromToken=USDC&toToken=NTZS&amount=10"
              code={`{
  "fromToken": "USDC",
  "toToken": "NTZS",
  "amountIn": "10",
  "minAmountOut": "37312.5",
  "midRate": 3750,
  "spreadBps": 150,
  "protocolFeeBps": 10
}`}
            />
          </div>
        </div>
      </Section>

      {/* Spread */}
      <Section id="spread" title="Configure Spread">
        <div className="fx-fade-up fx-delay-1 space-y-4">
          <p className="text-sm text-zinc-500">
            Updates the bid and ask spread for the LP position. Both values are in basis points.
            Min 10, max 500 per side.
          </p>
          <EndpointBadge method="PATCH" path="/api/v1/mm/spread" />
          <table className="w-full text-xs border-collapse mb-2">
            <tbody>
              <ParamRow name="bidBps" type="integer" required desc="Bid spread in bps (nTZS → USDC direction). Min 10, max 500." />
              <ParamRow name="askBps" type="integer" required desc="Ask spread in bps (USDC → nTZS direction). Min 10, max 500." />
            </tbody>
          </table>
          <CodeBlock
            label="Request body"
            code={`{
  "bidBps": 120,
  "askBps": 150
}`}
          />
          <CodeBlock
            label="Response"
            code={`{
  "bidBps": 120,
  "askBps": 150,
  "updatedAt": "2026-04-08T09:30:00Z"
}`}
          />
        </div>
      </Section>

      {/* Activate */}
      <Section id="activate" title="Activate / Deactivate">
        <div className="fx-fade-up fx-delay-1 space-y-4">
          <p className="text-sm text-zinc-500">
            Activates or deactivates the LP position. Activating sweeps inventory from the LP
            wallet to the solver pool and makes the position available to the matching engine.
            Deactivating returns tokens to the LP wallet.
          </p>
          <EndpointBadge method="PATCH" path="/api/v1/mm/activate" />
          <table className="w-full text-xs border-collapse mb-2">
            <tbody>
              <ParamRow name="isActive" type="boolean" required desc="true to activate, false to deactivate" />
            </tbody>
          </table>
          <CodeBlock
            label="Request body"
            code={`{
  "isActive": true
}`}
          />
          <CodeBlock
            label="Response"
            code={`{
  "isActive": true,
  "walletAddress": "0x723A3D...155aBe",
  "updatedAt": "2026-04-08T09:31:00Z"
}`}
          />
        </div>
      </Section>

      {/* Fills */}
      <Section id="fills" title="Fill History">
        <div className="fx-fade-up fx-delay-1 space-y-4">
          <p className="text-sm text-zinc-500">
            Returns the most recent 100 fills for the LP position, ordered newest first.
          </p>
          <EndpointBadge method="GET" path="/api/v1/mm/fills" />
          <CodeBlock
            label="Response"
            code={`{
  "fills": [
    {
      "id": "fill_01jqe...",
      "fromToken": "USDC",
      "toToken": "NTZS",
      "amountIn": "10.000000",
      "amountOut": "37312.500000000000000000",
      "feesEarned": "37.312500000000000000",
      "txHash": "0xabc123...",
      "createdAt": "2026-04-08T09:28:00Z"
    }
  ]
}`}
          />
        </div>
      </Section>

      {/* Withdraw */}
      <Section id="withdraw" title="Withdraw">
        <div className="fx-fade-up fx-delay-1 space-y-4">
          <p className="text-sm text-zinc-500">
            Withdraws tokens from the LP wallet to an external address. The LP position must
            be deactivated before withdrawing the full balance.
          </p>
          <EndpointBadge method="POST" path="/api/v1/mm/withdraw" />
          <table className="w-full text-xs border-collapse mb-2">
            <tbody>
              <ParamRow name="token" type="string" required desc={'"ntzs" or "usdc"'} />
              <ParamRow name="toAddress" type="string" required desc="Destination EVM address (0x...)" />
              <ParamRow name="amount" type="string" required desc='Human-readable amount e.g. "500.00"' />
            </tbody>
          </table>
          <CodeBlock
            label="Request body"
            code={`{
  "token": "ntzs",
  "toAddress": "0xRecipient...",
  "amount": "500.00"
}`}
          />
          <CodeBlock
            label="Response"
            code={`{
  "txHash": "0xdef456...",
  "status": "confirmed"
}`}
          />
        </div>
      </Section>

      {/* Errors */}
      <Section id="errors" title="Error Codes">
        <div className="fx-fade-up fx-delay-1 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/8">
                <th className="text-left py-2 pr-6 text-zinc-600 font-medium">Code</th>
                <th className="text-left py-2 pr-6 text-zinc-600 font-medium">HTTP</th>
                <th className="text-left py-2 text-zinc-600 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {[
                ['UNAUTHORIZED', '401', 'Missing or invalid API key'],
                ['FORBIDDEN', '403', 'Insufficient permissions for this operation'],
                ['NOT_FOUND', '404', 'LP account or resource not found'],
                ['INSUFFICIENT_BALANCE', '400', 'Wallet balance too low for the requested operation'],
                ['INSUFFICIENT_LIQUIDITY', '400', 'Solver pool lacks enough output tokens'],
                ['INVALID_AMOUNT', '400', 'Amount is zero, negative, or non-numeric'],
                ['INVALID_ADDRESS', '400', 'Destination address failed checksum validation'],
                ['SPREAD_OUT_OF_RANGE', '400', 'Bid or ask bps outside the 10–500 range'],
                ['POSITION_INACTIVE', '400', 'Operation requires an active LP position'],
                ['RATE_LIMIT', '429', 'Exceeded 60 requests/minute for this API key'],
                ['INTERNAL_ERROR', '500', 'Unexpected server error — contact support'],
              ].map(([code, http, desc]) => (
                <tr key={code}>
                  <td className="py-2.5 pr-6 font-mono text-zinc-300">{code}</td>
                  <td className="py-2.5 pr-6 text-zinc-600">{http}</td>
                  <td className="py-2.5 text-zinc-500">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Code examples */}
      <Section id="examples" title="Integration Examples">
        <div className="fx-fade-up fx-delay-1 space-y-6">
          <div>
            <p className="text-xs text-zinc-600 mb-2 uppercase tracking-wider">Node.js / TypeScript</p>
            <CodeBlock
              lang="typescript"
              code={`const BASE = 'https://simplefx.io/api/v1/mm'
const KEY = process.env.SIMPLEFX_API_KEY

async function getBalances() {
  const res = await fetch(\`\${BASE}/balances\`, {
    headers: { Authorization: \`Bearer \${KEY}\` },
  })
  return res.json()
}

async function setSpread(bidBps: number, askBps: number) {
  const res = await fetch(\`\${BASE}/spread\`, {
    method: 'PATCH',
    headers: {
      Authorization: \`Bearer \${KEY}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bidBps, askBps }),
  })
  return res.json()
}`}
            />
          </div>
          <div>
            <p className="text-xs text-zinc-600 mb-2 uppercase tracking-wider">cURL</p>
            <CodeBlock
              lang="bash"
              code={`# Get current balances
curl https://simplefx.io/api/v1/mm/balances \\
  -H "Authorization: Bearer mm_live_xxxx"

# Update spread
curl -X PATCH https://simplefx.io/api/v1/mm/spread \\
  -H "Authorization: Bearer mm_live_xxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"bidBps": 120, "askBps": 150}'`}
            />
          </div>
        </div>
      </Section>
    </div>
  )
}
