import { InlineCode } from '../_components/code-block'

export default function OverviewPage() {
  return (
    <div>
      {/* Page header */}
      <div className="fx-fade-up mb-10 pb-8 border-b border-white/5">
        <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-600 mb-3">Documentation</p>
        <h1 className="text-3xl font-thin text-white mb-3">Overview</h1>
        <p className="text-zinc-500 text-sm leading-relaxed max-w-xl">
          SimpleFX is an on-chain liquidity provisioning protocol for the Tanzanian Shilling
          stablecoin, nTZS. Market makers deposit inventory, configure bid/ask spreads, and earn
          fees automatically as swap orders fill against their pool.
        </p>
        <p className="text-xs text-zinc-700 mt-4">Last updated: 8 April 2026</p>
      </div>

      {/* Getting Started */}
      <div id="getting-started" className="fx-fade-up fx-delay-1 mb-12">
        <h2 className="text-base font-medium text-white mb-6 pb-2 border-b border-white/5">
          Getting Started
        </h2>
        <div className="space-y-8">
          {[
            {
              step: '01',
              title: 'Create an LP Wallet',
              body: 'Navigate to the SimpleFX homepage and enter your email address. An LP wallet (an EVM-compatible externally owned account on Base mainnet) is provisioned for you instantly. Your wallet address is deterministically derived from your account using BIP-44 HD wallet derivation.',
            },
            {
              step: '02',
              title: 'Complete Identity Verification',
              body: 'Tanzanian law requires identity verification before you can activate your LP position. You will need: a government-issued photo ID (NIDA card, passport, or driving licence), proof of address dated within 90 days, and a source of funds declaration for deposits above applicable thresholds.',
            },
            {
              step: '03',
              title: 'Deposit Inventory',
              body: 'Send nTZS or USDC directly to your LP wallet address. The minimum initial nTZS deposit to activate a position is 10,000 nTZS. Deposits are visible in your LP Dashboard under Inventory.',
            },
            {
              step: '04',
              title: 'Configure Your Spread',
              body: 'Set your bid and ask spread in basis points from the Spread page. A 150 bps ask spread means you sell nTZS to buyers at 1.5% above mid-market. The platform enforces a minimum of 10 bps and a maximum of 500 bps per side.',
            },
            {
              step: '05',
              title: 'Go Live',
              body: 'Activate your LP position from the Overview page. Your inventory becomes immediately available to the matching engine. Orders fill automatically and earned fees accrue to your LP wallet in real time.',
            },
          ].map((s) => (
            <div key={s.step} className="flex gap-5">
              <span className="text-[10px] font-mono text-zinc-700 mt-0.5 shrink-0 w-6">{s.step}</span>
              <div>
                <p className="text-sm font-medium text-zinc-200 mb-1">{s.title}</p>
                <p className="text-sm text-zinc-500 leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Supported Assets */}
      <div id="assets" className="fx-fade-up fx-delay-2 mb-12">
        <h2 className="text-base font-medium text-white mb-6 pb-2 border-b border-white/5">
          Supported Assets
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/8">
                <th className="text-left py-2 pr-6 text-zinc-600 font-medium">Token</th>
                <th className="text-left py-2 pr-6 text-zinc-600 font-medium">Description</th>
                <th className="text-left py-2 pr-6 text-zinc-600 font-medium">Contract (Base)</th>
                <th className="text-left py-2 text-zinc-600 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              <tr>
                <td className="py-3 pr-6 font-mono text-zinc-200">nTZS</td>
                <td className="py-3 pr-6 text-zinc-400">Tanzanian Shilling stablecoin</td>
                <td className="py-3 pr-6 font-mono text-zinc-500 text-[11px]">0xF476BA98...10688</td>
                <td className="py-3"><span className="text-[10px] font-medium text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded">Live</span></td>
              </tr>
              <tr>
                <td className="py-3 pr-6 font-mono text-zinc-200">USDC</td>
                <td className="py-3 pr-6 text-zinc-400">USD Coin (Circle)</td>
                <td className="py-3 pr-6 font-mono text-zinc-500 text-[11px]">0x833589fC...02913</td>
                <td className="py-3"><span className="text-[10px] font-medium text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded">Live</span></td>
              </tr>
              <tr>
                <td className="py-3 pr-6 font-mono text-zinc-200">USDT</td>
                <td className="py-3 pr-6 text-zinc-400">Tether USD</td>
                <td className="py-3 pr-6 font-mono text-zinc-500 text-[11px]">—</td>
                <td className="py-3"><span className="text-[10px] font-medium text-zinc-500 bg-white/5 border border-white/8 px-2 py-0.5 rounded">Roadmap</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* How Spreads Work */}
      <div id="spreads" className="fx-fade-up fx-delay-3 mb-12">
        <h2 className="text-base font-medium text-white mb-6 pb-2 border-b border-white/5">
          How Spreads Work
        </h2>
        <div className="space-y-4 text-sm text-zinc-500 leading-relaxed">
          <p>
            All prices are expressed relative to the on-chain oracle mid-market rate. You set
            two values — <span className="text-zinc-300">bid bps</span> and{' '}
            <span className="text-zinc-300">ask bps</span> — both in basis points (1 bps = 0.01%).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-6">
            {[
              {
                label: 'Ask spread',
                formula: 'output = amount × midRate × (1 − askBps / 10000)',
                desc: 'Applied on USDC → nTZS swaps. Buyer receives slightly fewer nTZS.',
                color: 'border-blue-500/20 bg-blue-500/[0.04]',
              },
              {
                label: 'Bid spread',
                formula: 'output = (amount / midRate) × (1 + bidBps / 10000)',
                desc: 'Applied on nTZS → USDC swaps. Seller receives slightly more USDC per nTZS.',
                color: 'border-zinc-700 bg-white/[0.02]',
              },
            ].map((card) => (
              <div key={card.label} className={`rounded-lg border p-4 ${card.color}`}>
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">{card.label}</p>
                <p className="font-mono text-xs text-zinc-300 mb-2">{card.formula}</p>
                <p className="text-xs text-zinc-500">{card.desc}</p>
              </div>
            ))}
          </div>
          <p>
            The protocol fee (currently 0.1%) is deducted from LP earnings on each filled order.
            Your effective net spread is your configured spread minus the protocol fee.
          </p>
        </div>
      </div>

      {/* Security */}
      <div id="security" className="fx-fade-up fx-delay-3 mb-12">
        <h2 className="text-base font-medium text-white mb-6 pb-2 border-b border-white/5">
          Security
        </h2>
        <div className="space-y-3 text-sm text-zinc-500 leading-relaxed">
          <p>
            LP wallets are derived from per-account BIP-44 HD wallet paths using the derivation
            scheme <InlineCode>m/44&apos;/8453&apos;/0&apos;/0/&#123;index&#125;</InlineCode> (Base coin type).
            Private keys are derived on-demand for transaction signing and are never persisted to
            disk or application logs.
          </p>
          <p>
            All wallet seeds are stored AES-256-GCM encrypted. The encryption key is an
            environment-level secret and is never exposed to application code at rest.
          </p>
          <p>
            We recommend using a unique, strong password for the email address associated with
            your LP account. Your email is used for one-time-password authentication and account
            recovery.
          </p>
        </div>
      </div>

      {/* FAQ */}
      <div id="faq" className="fx-fade-up fx-delay-4 mb-12">
        <h2 className="text-base font-medium text-white mb-6 pb-2 border-b border-white/5">FAQ</h2>
        <div className="space-y-5">
          {[
            {
              q: 'Is there a minimum deposit?',
              a: 'Yes. The minimum initial nTZS deposit to activate an LP position is 10,000 nTZS.',
            },
            {
              q: 'Can I withdraw my inventory at any time?',
              a: 'Yes. Initiate a withdrawal from the LP Dashboard at any time. Withdrawals settle on-chain, typically in under 2 minutes on Base mainnet.',
            },
            {
              q: 'How are earnings paid out?',
              a: 'Earnings accrue to your LP wallet in real time as orders fill. There is no lock-up period.',
            },
            {
              q: 'What is the nTZS contract address on Base?',
              a: '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688',
            },
            {
              q: 'Can I connect programmatically without the web dashboard?',
              a: 'Yes. The Market Maker API (see API Reference) provides API key-based access to all LP functions. This is the recommended integration path for automated market making.',
            },
          ].map((faq) => (
            <div key={faq.q} className="border-b border-white/[0.04] pb-5 last:border-0">
              <p className="text-sm text-zinc-200 mb-1.5">{faq.q}</p>
              <p className="text-sm text-zinc-500 leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Support */}
      <div className="fx-fade-up fx-delay-5 rounded-lg border border-white/5 bg-white/[0.02] px-6 py-5">
        <p className="text-sm font-medium text-zinc-300 mb-1">Need help?</p>
        <p className="text-sm text-zinc-500">
          Email{' '}
          <a href="mailto:devops@ntzs.co.tz" className="text-blue-400 hover:text-blue-300 transition-colors">
            devops@ntzs.co.tz
          </a>{' '}
          for technical or account queries, or{' '}
          <a href="mailto:devops@ntzs.co.tz" className="text-blue-400 hover:text-blue-300 transition-colors">
            devops@ntzs.co.tz
          </a>{' '}
          for compliance matters.
        </p>
      </div>
    </div>
  )
}
