import { H1, Lead, H2, P, Code, Endpoint } from '../_components/ui'

export default function RampDocs() {
  return (
    <>
      <H1>Ramp</H1>
      <Lead>
        Wallet-less settlement: convert USDC ⇄ mobile money (TZS) over the API — no per-end-user
        wallets. You keep a USDC float with us; off-ramps debit it, on-ramps deliver USDC to you.
        Requires the <code className="text-white/80">ramp</code> capability + approved KYB.
      </Lead>

      <H2>How settlement works</H2>
      <P>
        You fund <strong>USDC only</strong> — nTZS is an internal rail you never touch.
        Off-ramp: your USDC → (internal) nTZS → burned → fiat paid to the recipient&apos;s phone.
        On-ramp: we collect TZS → mint nTZS → convert to USDC → deliver it to you.
      </P>

      <H2>1. Settlement balance</H2>
      <P>Your settlement address (where you pre-fund USDC on Base) and its current float.</P>
      <Endpoint method="GET" path="/api/v1/ramp/balance" />
      <Code>{`curl https://www.ntzs.co.tz/api/v1/ramp/balance \\
  -H "Authorization: Bearer $NTZS_API_KEY"

# { "settlementAddress": "0x…", "chain": "base",
#   "token": { "symbol": "USDC", "decimals": 6 }, "usdcBalance": "2500.0" }`}</Code>

      <H2>2. Quote</H2>
      <P>Lock a rate before settling. Off-ramp: pass <code className="text-white/80">usdcAmount</code>. On-ramp: pass <code className="text-white/80">tzsAmount</code>.</P>
      <Endpoint method="POST" path="/api/v1/ramp/quote" />
      <Code>{`curl -X POST https://www.ntzs.co.tz/api/v1/ramp/quote \\
  -H "Authorization: Bearer $NTZS_API_KEY" -H "Content-Type: application/json" \\
  -d '{ "direction": "offramp", "usdcAmount": 10 }'

# { "quoteId": "…", "usdcAmount": 10, "tzsAmount": 25800,
#   "feeTzs": 1640, "rateUsdTzs": 2740, "expiresAt": "…" }`}</Code>

      <H2>3a. Off-ramp (USDC → mobile money)</H2>
      <P>Consume an off-ramp quote and pay TZS to a recipient phone. Idempotent.</P>
      <Endpoint method="POST" path="/api/v1/ramp/offramp" />
      <Code>{`curl -X POST https://www.ntzs.co.tz/api/v1/ramp/offramp \\
  -H "Authorization: Bearer $NTZS_API_KEY" -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{ "quoteId": "…", "phoneNumber": "0744000000" }'

# 201/202 { "settlementId": "…", "status": "completed" | "paying_out" }`}</Code>

      <H2>3b. On-ramp (mobile money → USDC)</H2>
      <P>
        Prompt a payer&apos;s phone for mobile money; once paid, we deliver USDC to your
        <code className="text-white/80"> destinationAddress</code> (or your float). Idempotent.
      </P>
      <Endpoint method="POST" path="/api/v1/ramp/onramp" />
      <Code>{`curl -X POST https://www.ntzs.co.tz/api/v1/ramp/onramp \\
  -H "Authorization: Bearer $NTZS_API_KEY" -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{ "quoteId": "…", "phoneNumber": "0744000000", "destinationAddress": "0x…" }'

# 202 { "settlementId": "…", "status": "minting" }`}</Code>

      <H2>4. Settlement status</H2>
      <Endpoint method="GET" path="/api/v1/ramp/[id]" />
      <Endpoint method="GET" path="/api/v1/ramp/settlements" />
      <P>
        Poll a settlement, or list recent ones. You&apos;ll also receive webhooks:
        <code className="text-white/80"> ramp.settlement.completed</code> and
        <code className="text-white/80"> ramp.settlement.failed</code>.
      </P>

      <H2>Notes</H2>
      <ul className="mt-3 space-y-2 text-sm text-white/65">
        <li>• Quotes expire (~60s) — request a fresh one if it lapses.</li>
        <li>• Off-ramp requires enough USDC float; on-ramp requires no pre-funding.</li>
        <li>• A failed off-ramp payout is automatically reverted; ambiguous failures are flagged for reconciliation (never silently lost).</li>
      </ul>
    </>
  )
}
