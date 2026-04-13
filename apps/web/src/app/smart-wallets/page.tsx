import Image from 'next/image'
import Link from 'next/link'
import { ChartNoAxesCombined, KeyRound, Landmark, Workflow } from 'lucide-react'

import { SmartWalletsHero } from './_components/SmartWalletsHero'

export default function SmartWalletsPage() {
  return (
    <div className="bg-black text-white">
      {/* Hero + partner slider (client component) */}
      <SmartWalletsHero />

      {/* Below-fold content */}
      <div className="mx-auto w-full max-w-6xl px-6 pb-24 lg:px-12">
        {/* Feature Grid */}
        <section className="mt-24 grid gap-6 md:grid-cols-2">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl transition-transform hover:-translate-y-1">
            <div className="h-12 w-12 rounded-full bg-blue-500/20 flex items-center justify-center mb-6 border border-blue-500/30">
              <KeyRound className="h-5 w-5 text-blue-300" strokeWidth={2.2} />
            </div>
            <h3 className="text-xl font-semibold mb-3">Partner-Isolated HD Wallets</h3>
            <p className="text-white/60 leading-relaxed">
              Every partner gets an isolated encrypted seed, and each user wallet is deterministically derived on demand. No private key storage, no seed phrase UX, and instant provisioning via API.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl transition-transform hover:-translate-y-1">
            <div className="h-12 w-12 rounded-full bg-indigo-500/20 flex items-center justify-center mb-6 border border-indigo-500/30">
              <Landmark className="h-5 w-5 text-indigo-300" strokeWidth={2.2} />
            </div>
            <h3 className="text-xl font-semibold mb-3">Treasury & Fee Controls</h3>
            <p className="text-white/60 leading-relaxed">
              Configure platform fees, route deposit collection to treasury, and monitor treasury balances from one partner dashboard. Built for marketplaces and payout-heavy flows.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl transition-transform hover:-translate-y-1">
            <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center mb-6 border border-emerald-500/30">
              <Workflow className="h-5 w-5 text-emerald-300" strokeWidth={2.2} />
            </div>
            <h3 className="text-xl font-semibold mb-3">Programmable TZS Flows</h3>
            <p className="text-white/60 leading-relaxed">
              Run deposits, transfers, and withdrawals over native M-Pesa rails with webhook-driven automation. Funds settle on Base while users operate in familiar TZS amounts.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl transition-transform hover:-translate-y-1">
            <div className="h-12 w-12 rounded-full bg-orange-500/20 flex items-center justify-center mb-6 border border-orange-500/30">
              <ChartNoAxesCombined className="h-5 w-5 text-orange-300" strokeWidth={2.2} />
            </div>
            <h3 className="text-xl font-semibold mb-3">Operational Visibility</h3>
            <p className="text-white/60 leading-relaxed">
              Track wallets, transfers, deposits, treasury balances, and settings with clear named views in the partner dashboard. Ship faster with fewer support loops.
            </p>
          </div>
        </section>
        
        {/* Code Preview Teaser */}
        <section className="mt-24 rounded-[28px] border border-white/10 bg-black/40 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl">
           <div className="border-b border-white/10 px-6 py-4 flex items-center gap-3">
             <div className="flex gap-1.5">
               <div className="h-3 w-3 rounded-full bg-red-500/80"></div>
               <div className="h-3 w-3 rounded-full bg-yellow-500/80"></div>
               <div className="h-3 w-3 rounded-full bg-green-500/80"></div>
             </div>
             <div className="text-xs text-white/40 font-mono ml-4">create-user.ts</div>
           </div>
           <div className="p-6 md:p-8 overflow-x-auto">
             <pre className="font-mono text-sm leading-relaxed">
               <span className="text-blue-400">const</span> <span className="text-white">user</span> <span className="text-blue-400">=</span> <span className="text-purple-400">await</span> <span className="text-white">ntzs.users.</span><span className="text-yellow-200">create</span><span className="text-white">(&#123;</span>{'\n'}
              <span className="text-white">  externalId: </span><span className="text-green-300">&apos;user_123&apos;</span><span className="text-white">,</span>{'\n'}
              <span className="text-white">  name: </span><span className="text-green-300">&apos;Asha M.&apos;</span><span className="text-white">,</span>{'\n'}
              <span className="text-white">  email: </span><span className="text-green-300">&apos;builder@startup.com&apos;</span><span className="text-white">,</span>{'\n'}
              <span className="text-white">&#125;)</span>{'\n'}
              {'\n'}
              <span className="text-white/40">{`// Wallet derived from your partner HD tree on Base`}</span>{'\n'}
              <span className="text-blue-400">console</span><span className="text-white">.</span><span className="text-yellow-200">log</span><span className="text-white">(user.walletAddress)</span>{'\n'}
              <span className="text-white/40">{`// -> 0xFfD2dF4aA86978A8971493B20287F5632bC0Fb5d`}</span>
            </pre>
           </div>
        </section>

        <footer className="mt-32 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-8 text-xs text-white/60 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <div className="overflow-hidden rounded-full">
              <Image src="/ntzs-logo.png" alt="nTZS" width={18} height={18} />
            </div>
            <div>nTZS</div>
          </div>
          <div className="flex items-center gap-4">
            <Link className="hover:text-white" href="/">
              Digital Reserve
            </Link>
            <Link className="hover:text-white" href="/developers">
              Developers
            </Link>
            <Link className="hover:text-white" href="/developers/login">
              Partner Login
            </Link>
          </div>
        </footer>
      </div>
    </div>
  )
}
