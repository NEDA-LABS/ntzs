'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

function CodeBlock({ title, code }: { title: string; code: string }) {
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
    // Enable smooth scrolling for html
    document.documentElement.style.scrollBehavior = 'smooth'

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        })
      },
      {
        rootMargin: '-100px 0px -60% 0px', // Trigger when section is near top of screen
      }
    )

    // Observe all sections with IDs
    const sections = document.querySelectorAll('section[id]')
    sections.forEach((section) => observer.observe(section))

    return () => {
      document.documentElement.style.scrollBehavior = 'auto' // Cleanup
      sections.forEach((section) => observer.unobserve(section))
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
        {/* Sidebar nav */}
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1 text-sm">
            <div className="mb-4 text-xs font-medium uppercase tracking-wider text-white/40">
              Quick Start
            </div>
            <a href="#install" className={navItemClass('install')}>
              Install SDK
            </a>
            <a href="#init" className={navItemClass('init')}>
              Initialize Client
            </a>
            <a href="#users" className={navItemClass('users')}>
              Create Users
            </a>
            <a href="#deposits" className={navItemClass('deposits')}>
              Deposits (On-Ramp)
            </a>
            <a href="#transfers" className={navItemClass('transfers')}>
              Transfers
            </a>
            <a href="#withdrawals" className={navItemClass('withdrawals')}>
              Withdrawals (Off-Ramp)
            </a>
            <a href="#balance" className={navItemClass('balance')}>
              Check Balance
            </a>
            <a href="#webhooks" className={navItemClass('webhooks')}>
              Webhooks
            </a>
            <div className="mt-6 mb-4 text-xs font-medium uppercase tracking-wider text-white/40">
              Reference
            </div>
            <a href="#errors" className={navItemClass('errors')}>
              Error Handling
            </a>
            <a href="#auth" className={navItemClass('auth')}>
              Authentication
            </a>
          </nav>
        </aside>

        {/* Main content */}
        <div className="min-w-0 space-y-16">
          {/* Hero */}
          <div>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
              nTZS Developer Documentation
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/70">
              Add digital TZS payments to your app with a single SDK. This guide walks you through
              installation, user creation, deposits, transfers, and withdrawals.
            </p>
            <div className="mt-6 flex gap-3">
              <Link
                href="/developers/signup"
                className="inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-black hover:bg-white/90"
              >
                Get your API Key
              </Link>
              <Link
                href="/developers/dashboard"
                className="inline-flex h-10 items-center rounded-full border border-white/15 bg-white/5 px-5 text-sm text-white/80 hover:bg-white/10"
              >
                Open Dashboard
              </Link>
            </div>
          </div>

          {/* Install */}
          <DocSection
            id="install"
            step="Step 1"
            title="Install the SDK"
            description="Install @ntzs/sdk from npm. Works with any Node.js or TypeScript project."
          >
            <CodeBlock
              title="Terminal"
              code="npm install @ntzs/sdk"
            />
          </DocSection>

          {/* Initialize */}
          <DocSection
            id="init"
            step="Step 2"
            title="Initialize the client"
            description="Create an NtzsClient instance with your API key. You'll get this key from your partner dashboard."
          >
            <CodeBlock
              title="app.ts"
              code={`import { NtzsClient } from '@ntzs/sdk'

const ntzs = new NtzsClient({
  apiKey: process.env.NTZS_API_KEY!,
  baseUrl: 'https://api.ntzs.co'
})`}
            />
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200/80">
              <span className="font-semibold text-amber-300">Security:</span> Never expose your API key in
              client-side code. Always call the nTZS API from your backend.
            </div>
          </DocSection>

          {/* Users */}
          <DocSection
            id="users"
            step="Step 3"
            title="Create users"
            description="Register a user and instantly provision an on-chain wallet. Each user gets a unique Base wallet address."
          >
            <CodeBlock
              title="create-user.ts"
              code={`const user = await ntzs.users.create({
  externalId: 'your-internal-user-id',
  email: 'user@example.com',
  phone: '255712345678'  // optional
})

console.log(user.walletAddress)
// → 0xFfD2dF4aA86978A8971493B20287F5632bC0Fb5d`}
            />
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              <span className="font-semibold text-white/90">Idempotent:</span> Calling create with the same{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">externalId</code> returns the
              existing user. Safe to retry.
            </div>
          </DocSection>

          {/* Deposits */}
          <DocSection
            id="deposits"
            step="Step 4"
            title="Accept deposits (On-Ramp)"
            description="Initiate an M-Pesa deposit. The user receives an STK push on their phone, pays, and nTZS tokens are minted to their wallet."
          >
            <CodeBlock
              title="deposit.ts"
              code={`const deposit = await ntzs.deposits.create({
  userId: user.id,
  amountTzs: 10000,
  phone: '255712345678'
})

// Check status later
const status = await ntzs.deposits.get(deposit.id)
console.log(status.status) // → 'minted'`}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs font-medium text-white/50">Flow</div>
                <div className="mt-2 text-sm text-white/80">M-Pesa STK Push → Payment confirmed → nTZS minted</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs font-medium text-white/50">Provider</div>
                <div className="mt-2 text-sm text-white/80">Snippe (Vodacom M-Pesa, Tigo Pesa, Airtel Money)</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs font-medium text-white/50">Settlement</div>
                <div className="mt-2 text-sm text-white/80">Real-time on Base. Tokens appear in balanceOf.</div>
              </div>
            </div>
          </DocSection>

          {/* Transfers */}
          <DocSection
            id="transfers"
            step="Step 5"
            title="Transfer between users"
            description="Move nTZS between any two users on your platform. Executed as a real ERC-20 transfer on Base."
          >
            <CodeBlock
              title="transfer.ts"
              code={`const transfer = await ntzs.transfers.create({
  fromUserId: senderUser.id,
  toUserId: recipientUser.id,
  amountTzs: 5000,
})

console.log(transfer.txHash)
// → 0x3a7b...real on-chain tx hash`}
            />
          </DocSection>

          {/* Withdrawals */}
          <DocSection
            id="withdrawals"
            step="Step 6"
            title="Cash out to M-Pesa (Off-Ramp)"
            description="Burn nTZS tokens and send TZS to the user's M-Pesa number. Fully automated."
          >
            <CodeBlock
              title="withdraw.ts"
              code={`const withdrawal = await ntzs.withdrawals.create({
  userId: user.id,
  amountTzs: 3000,
  phone: '255712345678'
})

// Tokens burned on-chain, TZS sent to M-Pesa`}
            />
          </DocSection>

          {/* Balance */}
          <DocSection
            id="balance"
            step="Read"
            title="Check balance"
            description="Read a user's on-chain nTZS balance at any time."
          >
            <CodeBlock
              title="balance.ts"
              code={`const { balanceTzs } = await ntzs.users.getBalance(user.id)
console.log(\`Balance: \${balanceTzs} TZS\`)

// Or get full user profile with balance
const profile = await ntzs.users.get(user.id)
console.log(profile.walletAddress, profile.balanceTzs)`}
            />
          </DocSection>

          {/* Webhooks */}
          <DocSection
            id="webhooks"
            step="Events"
            title="Webhooks"
            description="Receive real-time notifications when deposits complete, transfers settle, or withdrawals finish."
          >
            <CodeBlock
              title="webhook-handler.ts"
              code={`// Set your webhook URL in the partner dashboard
// nTZS will POST events to your endpoint

app.post('/webhooks/ntzs', (req, res) => {
  const event = req.body
  
  switch (event.type) {
    case 'deposit.completed':
      // nTZS minted to user's wallet
      break
    case 'transfer.completed':
      // On-chain transfer confirmed
      break
    case 'withdrawal.completed':
      // M-Pesa payout sent
      break
  }
  
  res.status(200).json({ received: true })
})`}
            />
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              <span className="font-semibold text-white/90">Webhook secret:</span> Configure your webhook URL and
              secret in the{' '}
              <Link href="/developers/dashboard" className="text-blue-400 hover:underline">
                partner dashboard
              </Link>
              . Events are signed with HMAC-SHA256 for verification.
            </div>
          </DocSection>

          {/* Errors */}
          <DocSection
            id="errors"
            step="Reference"
            title="Error handling"
            description="All API errors return a consistent JSON shape with an error message and HTTP status code."
          >
            <CodeBlock
              title="error-handling.ts"
              code={`import { NtzsClient, NtzsApiError } from '@ntzs/sdk'

try {
  await ntzs.deposits.create({ ... })
} catch (err) {
  if (err instanceof NtzsApiError) {
    console.log(err.status)  // 400, 401, 404, etc.
    console.log(err.message) // Human-readable error
  }
}`}
            />
          </DocSection>

          {/* Auth */}
          <DocSection
            id="auth"
            step="Reference"
            title="Authentication"
            description="All API requests require a Bearer token in the Authorization header."
          >
            <CodeBlock
              title="curl"
              code={`curl -X POST https://api.ntzs.co/api/v1/users \\
  -H "Authorization: Bearer ntzs_live_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{"externalId": "user_1", "email": "user@example.com"}'`}
            />
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              API keys start with <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">ntzs_test_</code> for
              testnet and <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">ntzs_live_</code> for
              production. Get yours from the{' '}
              <Link href="/developers/signup" className="text-blue-400 hover:underline">
                partner signup
              </Link>.
            </div>
          </DocSection>
        </div>
      </div>
    </div>
  )
}
