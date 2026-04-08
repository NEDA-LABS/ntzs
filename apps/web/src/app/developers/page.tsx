'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

function CodeBlock({ title, code, lang = 'bash' }: { title: string; code: string; lang?: string }) {
  void lang
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <span className="text-xs font-medium text-white/50">{title}</span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-emerald-300/90">
        {code}
      </pre>
    </div>
  )
}

function Note({ children, variant = 'neutral' }: { children: React.ReactNode; variant?: 'neutral' | 'warning' | 'info' }) {
  const styles = {
    neutral: 'border-white/10 bg-white/5 text-white/70',
    warning: 'border-amber-500/20 bg-amber-500/5 text-amber-200/80',
    info: 'border-blue-500/20 bg-blue-500/5 text-blue-200/80',
  }
  return (
    <div className={`rounded-xl border p-4 text-sm ${styles[variant]}`}>
      {children}
    </div>
  )
}

function DocSection({
  id,
  step,
  title,
  description,
  children,
}: {
  id: string
  step: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-4 inline-flex rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/50">
        {step}
      </div>
      <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">{description}</p>
      <div className="mt-6 space-y-4">{children}</div>
    </section>
  )
}

export default function DevelopersPage() {
  const [activeSection, setActiveSection] = useState('')

  useEffect(() => {
    document.documentElement.style.scrollBehavior = 'smooth'
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id)
        })
      },
      { rootMargin: '-100px 0px -60% 0px' }
    )
    const sections = document.querySelectorAll('section[id]')
    sections.forEach((s) => observer.observe(s))
    return () => {
      document.documentElement.style.scrollBehavior = 'auto'
      sections.forEach((s) => observer.unobserve(s))
    }
  }, [])

  const navItemClass = (id: string) =>
    `block rounded-lg px-3 py-1.5 transition-colors ${
      activeSection === id
        ? 'bg-white/10 text-white font-medium'
        : 'text-white/60 hover:bg-white/5 hover:text-white'
    }`

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="grid gap-12 lg:grid-cols-[220px_1fr]">
        {/* Sidebar */}
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1 text-sm">
            <div className="mb-4 text-xs font-medium uppercase tracking-wider text-white/40">Getting Started</div>
            <a href="#auth" className={navItemClass('auth')}>Authentication</a>
            <a href="#users" className={navItemClass('users')}>Create Users</a>
            <a href="#balance" className={navItemClass('balance')}>Get User &amp; Balance</a>
            <div className="mt-6 mb-4 text-xs font-medium uppercase tracking-wider text-white/40">Payments</div>
            <a href="#deposits" className={navItemClass('deposits')}>Deposits (On-Ramp)</a>
            <a href="#transfers" className={navItemClass('transfers')}>Transfers</a>
            <a href="#withdrawals" className={navItemClass('withdrawals')}>Withdrawals (Off-Ramp)</a>
            <div className="mt-6 mb-4 text-xs font-medium uppercase tracking-wider text-white/40">Advanced</div>
            <a href="#swap" className={navItemClass('swap')}>Swap (nTZS / USDC)</a>
            <a href="#webhooks" className={navItemClass('webhooks')}>Webhooks</a>
            <a href="#errors" className={navItemClass('errors')}>Error Reference</a>
          </nav>
        </aside>

        {/* Main content */}
        <div className="min-w-0 space-y-16">
          {/* Hero */}
          <div>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">nTZS WaaS API</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/70">
              Embed digital Tanzanian Shilling wallets directly into your product. Create users, accept M-Pesa
              deposits, send peer-to-peer transfers, and cash out to mobile money — all over a REST API.
            </p>
            <div className="mt-6 flex gap-3">
              <Link href="/developers/signup" className="inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-black hover:bg-white/90">
                Get API Key
              </Link>
              <Link href="/developers/dashboard" className="inline-flex h-10 items-center rounded-full border border-white/15 bg-white/5 px-5 text-sm text-white/80 hover:bg-white/10">
                Open Dashboard
              </Link>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Base URL', value: 'https://www.ntzs.co.tz' },
                { label: 'Network', value: 'Base mainnet' },
                { label: 'Token', value: 'nTZS (ERC-20, 18 decimals)' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-medium text-white/40 mb-1">{label}</div>
                  <div className="text-sm font-mono text-white/80">{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Auth */}
          <DocSection
            id="auth"
            step="Step 1"
            title="Authentication"
            description="Every request requires your partner API key as a Bearer token in the Authorization header. Keys are environment-scoped."
          >
            <CodeBlock
              title="curl"
              code={`curl -X POST https://www.ntzs.co.tz/api/v1/users \\
  -H "Authorization: Bearer ntzs_live_xxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"externalId":"user_1","email":"user@example.com"}'`}
            />
            <Note variant="neutral">
              <span className="font-semibold text-white/90">Key format:</span> Production keys start with{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">ntzs_live_</code>, test keys with{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">ntzs_test_</code>.
              Generate or rotate your key from the{' '}
              <Link href="/developers/dashboard" className="text-blue-400 hover:underline">partner dashboard</Link>.
            </Note>
            <Note variant="warning">
              <span className="font-semibold text-amber-300">Security:</span> Never expose your API key in
              client-side or mobile code. All nTZS API calls must originate from your backend server.
            </Note>
          </DocSection>

          {/* Users */}
          <DocSection
            id="users"
            step="Step 2"
            title="Create users"
            description="Register a user and provision an on-chain wallet in a single call. Wallets are deterministically derived from your partner seed — no blockchain transaction required."
          >
            <CodeBlock
              title="POST /api/v1/users — request"
              code={`const res = await fetch('https://www.ntzs.co.tz/api/v1/users', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ntzs_live_xxxxxxxxxxxx',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    externalId: 'your-internal-user-id',  // required — your own system's user ID
    email: 'user@example.com',            // required
    name: 'Jane Doe',                     // optional
    phone: '255712345678',                // optional, Tanzanian format
  }),
})`}
            />
            <CodeBlock
              title="201 response"
              code={`{
  "id": "14e17d04-ec7f-4d99-91a3-dfbaca19fba1",
  "externalId": "your-internal-user-id",
  "email": "user@example.com",
  "name": "Jane Doe",
  "phone": "255712345678",
  "walletAddress": "0x531B87EfdEBD19bfd05700DF6218d4786Cf2201C",
  "balance": 0
}`}
            />
            <Note variant="info">
              <span className="font-semibold text-blue-200">Store the <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">id</code> field.</span>{' '}
              This is the nTZS user ID you will pass as <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">userId</code> in all
              subsequent requests (deposits, transfers, withdrawals). It is different from your own
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs"> externalId</code>.
            </Note>
            <div className="grid gap-3 sm:grid-cols-2">
              <Note variant="neutral">
                <span className="font-semibold text-white/90">Idempotent:</span> Calling with the same{' '}
                <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">externalId</code> returns the
                existing user. Safe to call on every login.
              </Note>
              <Note variant="neutral">
                <span className="font-semibold text-white/90">Gas pre-funded:</span> New wallets are
                automatically topped up with a small ETH amount for gas. You do not need to fund wallets
                yourself.
              </Note>
            </div>
          </DocSection>

          {/* Balance */}
          <DocSection
            id="balance"
            step="Step 3"
            title="Get user profile &amp; balance"
            description="Fetch a user's on-chain nTZS balance alongside their profile. The balance is read live from Base mainnet at request time."
          >
            <CodeBlock
              title="GET /api/v1/users/:id"
              code={`const res = await fetch(
  'https://www.ntzs.co.tz/api/v1/users/14e17d04-ec7f-4d99-91a3-dfbaca19fba1',
  { headers: { 'Authorization': 'Bearer ntzs_live_xxxxxxxxxxxx' } }
)
const user = await res.json()
// {
//   id: "14e17d04-ec7f-4d99-91a3-dfbaca19fba1",
//   externalId: "your-internal-user-id",
//   email: "user@example.com",
//   phone: "255712345678",
//   walletAddress: "0x531B87EfdEBD19bfd05700DF6218d4786Cf2201C",
//   balanceTzs: 25000,   // nTZS balance (18 decimals, integer TZS units)
//   balanceUsdc: 6.50    // USDC balance (6 decimals, float)
// }`}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Note variant="neutral">
                <span className="font-semibold text-white/90">balanceTzs</span> — live nTZS balance read
                from the nTZS contract on Base mainnet. Increases on deposit, decreases on withdrawal or
                nTZS{'→'}USDC swap.
              </Note>
              <Note variant="neutral">
                <span className="font-semibold text-white/90">balanceUsdc</span> — live USDC balance in the
                same wallet. Accumulates when the user swaps nTZS{'→'}USDC. Both balances are fetched in
                parallel in a single API call.
              </Note>
            </div>
            <Note variant="info">
              Both fields are read directly from Base mainnet at request time — no caching. Always use this
              endpoint before initiating a transfer or withdrawal to confirm the user has sufficient funds.
            </Note>
          </DocSection>

          {/* Deposits */}
          <DocSection
            id="deposits"
            step="Step 4"
            title="Accept deposits (On-Ramp)"
            description="Initiate a payment in Tanzanian Shillings. On success, nTZS is minted 1:1 to the user's wallet. Supports mobile money and card payments."
          >
            <Note variant="info">
              <span className="font-semibold text-blue-200">userId</span> must be the{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">id</code> returned from{' '}
              <strong>POST /api/v1/users</strong> — not your own <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">externalId</code>.
            </Note>
            <CodeBlock
              title="POST /api/v1/deposits — mobile money"
              code={`const res = await fetch('https://www.ntzs.co.tz/api/v1/deposits', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ntzs_live_xxxxxxxxxxxx',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    userId: '14e17d04-ec7f-4d99-91a3-dfbaca19fba1', // id from POST /api/v1/users
    amountTzs: 10000,               // minimum 500 TZS
    paymentMethod: 'mobile_money',  // default
    phoneNumber: '255712345678',    // required for mobile_money — use phoneNumber, not phone
  }),
})
// { id, status: "submitted", amountTzs: 10000,
//   paymentMethod: "mobile_money",
//   instructions: "Check your phone for the mobile money payment prompt" }`}
            />
            <CodeBlock
              title="POST /api/v1/deposits — card"
              code={`body: JSON.stringify({
  userId: user.id,
  amountTzs: 10000,
  paymentMethod: 'card',
  redirectUrl: 'https://yourapp.com/payment/success',  // required, must be HTTPS
  cancelUrl:   'https://yourapp.com/payment/cancel',   // required, must be HTTPS
})
// { id, status: "submitted", amountTzs: 10000,
//   paymentMethod: "card",
//   paymentUrl: "https://pay.snippe.sh/c/..." }
// → redirect your user to paymentUrl to complete card payment`}
            />
            <CodeBlock
              title="POST /api/v1/deposits — collect to treasury"
              code={`// Payment-collection mode: mint nTZS directly to your platform treasury
// instead of the user's individual wallet. Useful for marketplaces and
// escrow flows where you collect funds before distributing them.
body: JSON.stringify({
  userId: user.id,          // the payer, for tracking
  amountTzs: 50000,
  paymentMethod: 'mobile_money',
  phoneNumber: '255712345678',
  collectToTreasury: true,  // mint to partner treasury wallet
})`}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Minimum', value: '500 TZS' },
                { label: 'Mobile providers', value: 'Vodacom (M-Pesa), Airtel (Airtel Money), Tigo (Tigo Pesa), Halotel (HaloPesa), TTCL (TTCL Pesa), Yass' },
                { label: 'Settlement', value: 'Real-time on Base mainnet after payment confirmation' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-medium text-white/50">{label}</div>
                  <div className="mt-2 text-sm text-white/80">{value}</div>
                </div>
              ))}
            </div>
          </DocSection>

          {/* Transfers */}
          <DocSection
            id="transfers"
            step="Step 5"
            title="Transfer between users"
            description="Move nTZS between any two users on your platform. Settlement is on-chain and synchronous — the API responds only after the transaction is confirmed."
          >
            <CodeBlock
              title="POST /api/v1/transfers"
              code={`const res = await fetch('https://www.ntzs.co.tz/api/v1/transfers', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ntzs_live_xxxxxxxxxxxx',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    fromUserId: 'uuid-of-sender',
    toUserId:   'uuid-of-recipient',
    amountTzs:  5000,
    metadata: { orderId: 'ord_123', note: 'Payment for order' }, // optional
  }),
})
const transfer = await res.json()
// {
//   id: "uuid...",
//   status: "completed",
//   txHash: "0xabc...",
//   amountTzs: 5000,
//   recipientAmountTzs: 4975,  // after platform fee
//   feeAmountTzs: 25,
//   feeTxHash: "0xdef..."      // fee tx to your treasury, if fee > 0
// }`}
            />
            <Note variant="neutral">
              <span className="font-semibold text-white/90">Platform fee:</span> Configure your fee percentage
              and treasury wallet address in the{' '}
              <Link href="/developers/dashboard" className="text-blue-400 hover:underline">dashboard</Link>.
              The fee is deducted from the sender and sent to your treasury in the same atomic operation.
            </Note>
            <Note variant="warning">
              <span className="font-semibold text-amber-300">Requirements:</span> Both users must belong to
              your platform, both wallets must be provisioned, and the sender must have sufficient balance.
              Gas is auto-managed — if the sender wallet is low on ETH, the relayer tops it up before
              sending.
            </Note>
          </DocSection>

          {/* Withdrawals */}
          <DocSection
            id="withdrawals"
            step="Step 6"
            title="Cash out to mobile money (Off-Ramp)"
            description="Burns nTZS tokens on-chain and sends TZS to the user's mobile money number. Supports all major Tanzanian mobile networks. The burn and payout happen automatically."
          >
            <CodeBlock
              title="POST /api/v1/withdrawals"
              code={`const res = await fetch('https://www.ntzs.co.tz/api/v1/withdrawals', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ntzs_live_xxxxxxxxxxxx',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    userId:      user.id,
    amountTzs:   10000,           // minimum 5,000 TZS
    phoneNumber: '255712345678',  // mobile money recipient (Vodacom, Airtel, Tigo, Halotel, TTCL, Yass)
  }),
})
const withdrawal = await res.json()
// Small amounts (< 100,000 TZS):
// { id, status: "burned", amountTzs: 10000,
//   message: "Withdrawal processed successfully." }
//
// Large amounts (>= 100,000 TZS):
// { id, status: "requested", amountTzs: 150000,
//   message: "Withdrawal requires admin approval for amounts >= 100,000 TZS." }`}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: 'Minimum', value: '5,000 TZS' },
                { label: 'Large withdrawal threshold', value: '>= 100,000 TZS requires admin approval and may take up to 1 business day' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-medium text-white/50">{label}</div>
                  <div className="mt-2 text-sm text-white/80">{value}</div>
                </div>
              ))}
            </div>
          </DocSection>

          {/* Swap */}
          <DocSection
            id="swap"
            step="Advanced"
            title="Swap nTZS / USDC"
            description="Let users swap between nTZS and USDC on Base. The swap settles directly against the LP pool and streams real-time status over SSE."
          >
            <CodeBlock
              title="POST /api/v1/swap — SSE stream"
              code={`const res = await fetch('https://www.ntzs.co.tz/api/v1/swap', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ntzs_live_xxxxxxxxxxxx',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    userId:      user.id,
    fromToken:   'USDC',   // 'USDC' or 'NTZS'
    toToken:     'NTZS',
    amount:      5,        // in fromToken units
    slippageBps: 100,      // optional, default 100 (1%)
  }),
})

// Response is text/event-stream — read with EventSource or manually:
const reader = res.body!.getReader()
const decoder = new TextDecoder()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const lines = decoder.decode(value).split('\\n')
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const update = JSON.parse(line.slice(6))
    console.log(update.status, update.message, update.txHash)
    // CHECKING → "Checking balance..."
    // SENDING  → "Sending 5 USDC to liquidity pool..."  txHash
    // FILLING  → "Sending nTZS to your wallet..."       txHash
    // FILLED   → "Swap complete!"                       txHash (final)
    // FAILED   → error message
  }
}`}
            />
            <CodeBlock
              title="curl (raw SSE)"
              code={`curl -N -X POST https://www.ntzs.co.tz/api/v1/swap \\
  -H "Authorization: Bearer ntzs_live_xxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"userId":"uuid...","fromToken":"USDC","toToken":"NTZS","amount":5}'

# data: {"status":"CHECKING","message":"Checking balance..."}
# data: {"status":"SENDING","message":"Sending 5 USDC to liquidity pool...","txHash":"0x..."}
# data: {"status":"FILLING","message":"Sending nTZS to your wallet...","txHash":"0x..."}
# data: {"status":"FILLED","message":"Swap complete!","txHash":"0x..."}`}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Supported pairs', value: 'nTZS / USDC (both directions)' },
                { label: 'Settlement', value: 'Two on-chain ERC-20 transfers on Base, ~5–10 seconds' },
                { label: 'Gas', value: 'Auto-managed. User wallet is pre-funded via the relayer if needed.' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-medium text-white/50">{label}</div>
                  <div className="mt-2 text-sm text-white/80">{value}</div>
                </div>
              ))}
            </div>
          </DocSection>

          {/* Webhooks */}
          <DocSection
            id="webhooks"
            step="Events"
            title="Webhooks"
            description="Receive real-time POST notifications to your server when payment events complete. Configure your endpoint and signing secret in the partner dashboard."
          >
            <CodeBlock
              title="webhook-handler.ts (Express)"
              code={`import crypto from 'crypto'

app.post('/webhooks/ntzs', express.raw({ type: 'application/json' }), (req, res) => {
  // Verify signature
  const sig = req.headers['x-ntzs-signature'] as string
  const expected = crypto
    .createHmac('sha256', process.env.NTZS_WEBHOOK_SECRET!)
    .update(req.body)
    .digest('hex')

  if (sig !== expected) {
    return res.status(400).send('Invalid signature')
  }

  const event = JSON.parse(req.body.toString())

  switch (event.type) {
    case 'deposit.completed':
      // event.data: { depositId, userId, amountTzs, walletAddress, txHash }
      await creditUserAccount(event.data.userId, event.data.amountTzs)
      break
    case 'transfer.completed':
      // event.data: { transferId, fromUserId, toUserId, amountTzs, txHash }
      break
    case 'withdrawal.completed':
      // event.data: { withdrawalId, userId, amountTzs, phoneNumber }
      break
  }

  res.status(200).json({ received: true })
})`}
            />
            <Note variant="neutral">
              Configure your webhook URL and secret in the{' '}
              <Link href="/developers/dashboard" className="text-blue-400 hover:underline">partner dashboard</Link>{' '}
              under Settings. Events are signed with HMAC-SHA256 — always verify the signature before
              processing.
            </Note>
          </DocSection>

          {/* Errors */}
          <DocSection
            id="errors"
            step="Reference"
            title="Error reference"
            description="All errors return a consistent JSON body. Match on the error field for programmatic handling."
          >
            <CodeBlock
              title="Error response shape"
              code={`// HTTP 4xx/5xx response body:
{
  "error": "insufficient_balance",   // machine-readable code
  "message": "Sender has insufficient nTZS balance",
  "details": {
    "available": 3200,
    "requested": 5000,
    "shortfall": 1800
  }
}`}
            />
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left text-xs font-medium text-white/50">Error code</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-white/50">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-white/50">Meaning</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {[
                    ['missing_required_fields', '400', 'A required body field is absent'],
                    ['invalid_amount', '400', 'Amount is zero, negative, or below minimum'],
                    ['invalid_transfer', '400', 'fromUserId equals toUserId'],
                    ['wallet_not_provisioned', '400', 'Wallet address is still being derived'],
                    ['insufficient_balance', '400', 'Sender does not have enough nTZS'],
                    ['user_not_found', '404', 'userId not found under your partner account'],
                    ['unauthorized', '401', 'Missing or invalid API key'],
                    ['relayer_unavailable', '503', 'Gas relay temporarily offline — retry shortly'],
                    ['blockchain_error', '500', 'On-chain transaction failed — see details.technicalError'],
                    ['network_error', '500', 'RPC connection timed out — retry'],
                  ].map(([code, status, meaning]) => (
                    <tr key={code} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-xs text-emerald-300/80">{code}</td>
                      <td className="px-4 py-3 text-white/50">{status}</td>
                      <td className="px-4 py-3 text-white/70">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DocSection>
        </div>
      </div>
    </div>
  )
}
