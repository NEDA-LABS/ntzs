import LegalLayout from '@/components/ui/legal-layout';

export const metadata = {
  title: 'Documentation — SimpleFX',
  description: 'Developer and LP documentation for SimpleFX, the open TZS liquidity market.',
};

export default function DocsPage() {
  return (
    <LegalLayout
      title="Documentation"
      subtitle="Docs"
      lastUpdated="30 March 2026"
    >
      <Section title="Overview">
        <p>SimpleFX is an on-chain liquidity provisioning protocol for the Tanzanian Shilling stablecoin, nTZS. Market makers (Liquidity Providers) deposit nTZS inventory, configure bid/ask spreads, and earn fees automatically as cross-chain swap orders fill against their inventory.</p>
        <p>The protocol is deployed on Base mainnet. Swaps settle directly against the LP pool on-chain.</p>
      </Section>

      <Section title="Getting Started">
        <h3 className="text-white text-sm font-medium mb-2">1. Create an LP Wallet</h3>
        <p>Navigate to the SimpleFX homepage and enter your email address. An LP Wallet (an EVM-compatible Externally Owned Account) is provisioned for you instantly. Your wallet address is deterministically derived from your account using BIP-44 HD wallet derivation.</p>

        <h3 className="text-white text-sm font-medium mb-2 mt-6">2. Complete Identity Verification</h3>
        <p>Tanzanian law requires identity verification before you can activate your LP Wallet. You will be asked to provide:</p>
        <ul>
          <li>A government-issued photo ID (NIDA card, passport, or driving licence)</li>
          <li>Proof of address (utility bill or bank statement dated within 90 days)</li>
          <li>Source of funds declaration for deposits above applicable thresholds</li>
        </ul>

        <h3 className="text-white text-sm font-medium mb-2 mt-6">3. Deposit nTZS Inventory</h3>
        <p>Once your wallet is active, deposit nTZS from any supported chain. The minimum initial deposit is 10,000 nTZS. Deposits are visible in your LP Dashboard under &quot;Inventory.&quot;</p>

        <h3 className="text-white text-sm font-medium mb-2 mt-6">4. Configure Your Spread</h3>
        <p>Set your bid and ask spread in basis points. For example, a 150 bps (1.5%) ask spread means you sell nTZS to incoming buyers at 1.5% above the mid-market price. The Platform enforces a minimum spread of 10 bps and a maximum of 500 bps per side.</p>

        <h3 className="text-white text-sm font-medium mb-2 mt-6">5. Go Live</h3>
        <p>Activate your LP position. Your inventory will immediately become available to the matching engine. Orders fill automatically; you receive earned fees in real time to your LP Wallet.</p>
      </Section>

      <Section title="Supported Assets">
        <table className="w-full text-xs border-collapse mt-2">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-2 pr-4 text-zinc-500 font-medium">Token</th>
              <th className="text-left py-2 pr-4 text-zinc-500 font-medium">Type</th>
              <th className="text-left py-2 text-zinc-500 font-medium">Networks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            <tr>
              <td className="py-2 pr-4 text-zinc-300 font-mono">nTZS</td>
              <td className="py-2 pr-4 text-zinc-400">Tanzanian Shilling stablecoin</td>
              <td className="py-2 text-zinc-400">Base, Ethereum, Polygon, Arbitrum</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 text-zinc-300 font-mono">USDC</td>
              <td className="py-2 pr-4 text-zinc-400">USD Coin (Circle)</td>
              <td className="py-2 text-zinc-400">Base, Ethereum, Polygon, Arbitrum</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 text-zinc-300 font-mono">USDT</td>
              <td className="py-2 pr-4 text-zinc-400">Tether USD</td>
              <td className="py-2 text-zinc-400">Ethereum, Polygon</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 text-zinc-300 font-mono">EURC</td>
              <td className="py-2 pr-4 text-zinc-400">Euro Coin (Circle)</td>
              <td className="py-2 text-zinc-400">Base, Ethereum</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Supported Networks">
        <table className="w-full text-xs border-collapse mt-2">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-2 pr-4 text-zinc-500 font-medium">Network</th>
              <th className="text-left py-2 pr-4 text-zinc-500 font-medium">Chain ID</th>
              <th className="text-left py-2 text-zinc-500 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            <tr>
              <td className="py-2 pr-4 text-zinc-300">Base</td>
              <td className="py-2 pr-4 text-zinc-400 font-mono">8453</td>
              <td className="py-2"><span className="text-blue-400">Live</span></td>
            </tr>
            <tr>
              <td className="py-2 pr-4 text-zinc-300">Ethereum</td>
              <td className="py-2 pr-4 text-zinc-400 font-mono">1</td>
              <td className="py-2"><span className="text-zinc-500">Coming soon</span></td>
            </tr>
            <tr>
              <td className="py-2 pr-4 text-zinc-300">Polygon</td>
              <td className="py-2 pr-4 text-zinc-400 font-mono">137</td>
              <td className="py-2"><span className="text-zinc-500">Coming soon</span></td>
            </tr>
            <tr>
              <td className="py-2 pr-4 text-zinc-300">Arbitrum One</td>
              <td className="py-2 pr-4 text-zinc-400 font-mono">42161</td>
              <td className="py-2"><span className="text-zinc-500">Coming soon</span></td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="How Spreads Work">
        <p>The spread is the difference between the price at which you are willing to sell nTZS (ask) and the price at which you are willing to buy nTZS (bid). All prices are expressed as a percentage above or below the on-chain oracle mid-market rate.</p>
        <p>Example with 10,000 nTZS inventory and a 1.5% ask / 1.2% bid spread:</p>
        <ul>
          <li>A buyer swapping USDC for nTZS receives nTZS at the oracle rate + 1.5%. You earn the 1.5% differential on the filled notional.</li>
          <li>A seller swapping nTZS for USDC receives USDC at the oracle rate — 1.2%. You earn the 1.2% differential.</li>
          <li>Your effective yield is the fill rate × average spread over the period.</li>
        </ul>
        <p>The Platform protocol fee (currently 0.1%) is deducted from LP earnings on each filled order.</p>
      </Section>

      <Section title="LP Dashboard">
        <p>The LP Dashboard provides real-time visibility into:</p>
        <ul>
          <li><strong>Inventory:</strong> nTZS and USDC balances in your LP Wallet</li>
          <li><strong>Orders:</strong> Live, filled, and cancelled orders against your spread</li>
          <li><strong>Earnings:</strong> Cumulative fees earned, broken down by side (bid/ask) and time period</li>
          <li><strong>Spread Config:</strong> Current bid/ask spread settings with one-click update</li>
          <li><strong>Deposits &amp; Withdrawals:</strong> On-chain transaction history for your LP Wallet</li>
        </ul>
      </Section>

      <Section title="Security">
        <p>SimpleFX uses a non-custodial architecture. LP Wallets are derived from per-user BIP-44 HD wallet paths. Private keys are derived on-demand for transaction signing and are never persisted to disk or logs.</p>
        <p>Smart contracts on Base mainnet have undergone both internal and independent third-party security audits. Contract addresses are published in the Platform interface.</p>
        <p>We recommend using a strong, unique email password and enabling any additional security features available in your email provider, as your email is used for account recovery.</p>
      </Section>

      <Section title="Regulatory Status">
        <p>NEDA Labs Ltd. operates SimpleFX as a technology infrastructure provider. The Company is registered in the United Republic of Tanzania. nTZS is issued and maintained by the nTZS protocol, which operates in accordance with applicable Tanzanian financial regulations including oversight by the Bank of Tanzania.</p>
        <p>Market makers are independently responsible for ensuring their use of SimpleFX complies with applicable laws in their jurisdiction, including tax obligations under the Tanzania Revenue Authority (TRA) and any applicable capital gains or income reporting requirements.</p>
      </Section>

      <Section title="FAQ">
        <div className="space-y-6">
          <FAQ
            q="Is there a minimum deposit?"
            a="Yes. The minimum initial nTZS deposit to activate an LP position is 10,000 nTZS."
          />
          <FAQ
            q="Can I withdraw my inventory at any time?"
            a="Yes. You may initiate a withdrawal at any time from the LP Dashboard. Withdrawals are processed on-chain and subject to standard network confirmation times (typically under 2 minutes on Base)."
          />
          <FAQ
            q="How are earnings paid out?"
            a="Earnings accrue directly to your LP Wallet in real time as orders fill. There is no lock-up period."
          />
          <FAQ
            q="What happens if my inventory runs out?"
            a="If your nTZS inventory is fully consumed by fills, your LP position is automatically paused. You can top up your inventory from the Dashboard to resume."
          />
          <FAQ
            q="Is SimpleFX available to non-Tanzanian residents?"
            a="The Platform is accessible globally subject to applicable local laws. You are responsible for ensuring your use of SimpleFX is lawful in your jurisdiction. Residents of sanctioned jurisdictions are prohibited from using the Platform."
          />
          <FAQ
            q="What is the nTZS contract address?"
            a="0xF476BA983DE2F1AD532380630e2CF1D1b8b10688 on Base mainnet."
          />
        </div>
      </Section>

      <Section title="Support">
        <p>For technical support, account queries, or compliance matters:</p>
        <p>
          Email: support@nedapay.xyz<br />
          For urgent compliance matters: legal@nedapay.xyz
        </p>
      </Section>
    </LegalLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-12">
      <h2 className="text-lg font-semibold text-white mb-4 pb-2 border-b border-white/5">{title}</h2>
      <div className="space-y-4 text-zinc-400 text-sm leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_strong]:text-zinc-300">
        {children}
      </div>
    </div>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <p className="text-zinc-300 font-medium mb-1">{q}</p>
      <p className="text-zinc-500">{a}</p>
    </div>
  );
}
