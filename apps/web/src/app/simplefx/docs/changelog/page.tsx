function Entry({
  version,
  date,
  tag,
  changes,
}: {
  version: string
  date: string
  tag: 'new' | 'fix' | 'breaking' | 'improvement'
  changes: string[]
}) {
  const tagStyles = {
    new: 'text-green-400 bg-green-500/10 border-green-500/20',
    fix: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    breaking: 'text-red-400 bg-red-500/10 border-red-500/20',
    improvement: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  }

  return (
    <div className="flex gap-8 pb-10 border-b border-white/[0.04] last:border-0">
      <div className="shrink-0 w-32">
        <p className="text-sm font-mono text-zinc-300">{version}</p>
        <p className="text-xs text-zinc-600 mt-0.5">{date}</p>
      </div>
      <div className="flex-1">
        <span className={`inline-block text-[9px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded border mb-3 ${tagStyles[tag]}`}>
          {tag}
        </span>
        <ul className="space-y-1.5">
          {changes.map((c, i) => (
            <li key={i} className="flex gap-2 text-sm text-zinc-500">
              <span className="text-zinc-700 shrink-0 mt-0.5">—</span>
              <span className="leading-relaxed">{c}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default function ChangelogPage() {
  return (
    <div>
      {/* Page header */}
      <div className="fx-fade-up mb-10 pb-8 border-b border-white/5">
        <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-600 mb-3">Documentation</p>
        <h1 className="text-3xl font-thin text-white mb-3">Changelog</h1>
        <p className="text-zinc-500 text-sm leading-relaxed max-w-xl">
          All notable changes to the SimpleFX protocol, LP dashboard, and Market Maker API.
        </p>
        <p className="text-xs text-zinc-700 mt-4">Last updated: 8 April 2026</p>
      </div>

      <div className="fx-fade-up fx-delay-1 space-y-0">
        <Entry
          version="v1.3.0"
          date="8 Apr 2026"
          tag="improvement"
          changes={[
            'Migrated swap execution from intent-based protocol to direct LP pool model. Eliminates token escrow risk on failed swaps.',
            'Swap pre-flight check now verifies solver pool liquidity before accepting the inbound transfer.',
            'Rebuild developer documentation with sidebar navigation and API reference.',
            'Removed stale cross-chain asset listings (USDT, EURC) — these are on the roadmap.',
          ]}
        />
        <Entry
          version="v1.2.1"
          date="30 Mar 2026"
          tag="fix"
          changes={[
            'Fixed balance display showing Sepolia testnet values instead of Base mainnet.',
            'Corrected 15+ server routes that prioritised BASE_SEPOLIA_RPC_URL over BASE_RPC_URL.',
            'TokenBalance client component now reads NEXT_PUBLIC_BASE_RPC_URL correctly.',
          ]}
        />
        <Entry
          version="v1.2.0"
          date="20 Mar 2026"
          tag="new"
          changes={[
            'LP Dashboard: added per-fill breakdown in the Fills tab.',
            'Spread page: live preview of effective buy/sell rates as you adjust bps sliders.',
            'Withdraw flow: added balance check before submitting on-chain transaction.',
            'Settings page: LP display name now editable inline.',
          ]}
        />
        <Entry
          version="v1.1.0"
          date="5 Mar 2026"
          tag="new"
          changes={[
            'SimpleFX LP portal launched on Base mainnet.',
            'OTP email authentication for LP accounts.',
            'BIP-44 HD wallet provisioning per LP account (coin type 8453, Base).',
            'nTZS / USDC trading pair with configurable bid/ask spread.',
            'Real-time fill streaming via Server-Sent Events.',
          ]}
        />
        <Entry
          version="v1.0.0"
          date="15 Feb 2026"
          tag="new"
          changes={[
            'WaaS API v1 launched: partner onboarding, user wallet creation, transfers.',
            'Per-partner HD seed isolation with AES-256-GCM encryption.',
            'nTZS contract deployed on Base mainnet: 0xF476BA983DE2F1AD532380630e2CF1D1b8b10688.',
          ]}
        />
      </div>
    </div>
  )
}
