import Image from 'next/image'
import Link from 'next/link'

export default function SmartWalletsPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Background Effects */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(121,40,202,0.25),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(0,112,243,0.25),transparent_45%),radial-gradient(circle_at_45%_90%,rgba(16,185,129,0.18),transparent_45%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="overflow-hidden rounded-full">
            <Image src="/ntzs-logo.png" alt="nTZS" width={34} height={34} />
          </div>
          <div className="text-sm font-semibold tracking-wide">nTZS</div>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-white/70 md:flex">
          <Link className="hover:text-white" href="/">
            Digital Reserve
          </Link>
          <Link className="text-white font-medium" href="/smart-wallets">
            Smart Wallets
          </Link>
          <Link className="hover:text-white" href="/developers">
            Developers
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 backdrop-blur-lg transition-colors hover:bg-white/10"
            href="/developers/login"
          >
            Partner Login
          </Link>
          <Link
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white/90"
            href="/developers/signup"
          >
            Get API Key
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24 pt-16 md:pt-24">
        {/* Hero */}
        <section className="text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-200 backdrop-blur-lg mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            Wallet as a Service (WaaS)
          </div>
          
          <h1 className="text-5xl font-semibold leading-[1.1] tracking-tight md:text-7xl">
            Smart Wallet Infrastructure for Africa.
          </h1>
          
          <p className="mt-6 text-lg leading-8 text-white/70 md:text-xl max-w-2xl mx-auto">
            Abstract away the complexity of blockchain. Instantly provision embedded wallets, program custom logic, and seamlessly on-ramp users via mobile money.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/developers/signup"
              className="inline-flex h-14 items-center justify-center rounded-full bg-white px-8 text-base font-semibold text-black transition-colors hover:bg-white/90 w-full sm:w-auto"
            >
              Start Building for Free
            </Link>
            <Link
              href="/developers"
              className="inline-flex h-14 items-center justify-center rounded-full border border-white/15 bg-white/5 px-8 text-base text-white/85 backdrop-blur-lg transition-colors hover:bg-white/10 w-full sm:w-auto"
            >
              Read the Docs
            </Link>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="mt-32 grid gap-6 md:grid-cols-2">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl transition-transform hover:-translate-y-1">
            <div className="h-12 w-12 rounded-full bg-blue-500/20 flex items-center justify-center mb-6 border border-blue-500/30">
              <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-3">Instant Provisioning</h3>
            <p className="text-white/60 leading-relaxed">
              Create an on-chain HD wallet for your users instantly via a single API call. No seed phrases, no private keys to manage, no friction.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl transition-transform hover:-translate-y-1">
            <div className="h-12 w-12 rounded-full bg-purple-500/20 flex items-center justify-center mb-6 border border-purple-500/30">
              <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-3">Gasless & Abstracted</h3>
            <p className="text-white/60 leading-relaxed">
              Users never see gas fees or network complexities. Transactions are signed server-side and settled instantly on Base network.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl transition-transform hover:-translate-y-1">
            <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center mb-6 border border-emerald-500/30">
              <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-3">Native M-Pesa Rails</h3>
            <p className="text-white/60 leading-relaxed">
              Built-in fiat on/off ramps via mobile money. Accept deposits and process withdrawals directly to and from your users' phones.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl transition-transform hover:-translate-y-1">
            <div className="h-12 w-12 rounded-full bg-orange-500/20 flex items-center justify-center mb-6 border border-orange-500/30">
              <svg className="w-6 h-6 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-3">Developer First</h3>
            <p className="text-white/60 leading-relaxed">
              Integrate in minutes with our comprehensive Node.js/TypeScript SDK. Full webhook support, robust error handling, and partner dashboard.
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
               <span className="text-white">  externalId: </span><span className="text-green-300">'user_123'</span><span className="text-white">,</span>{'\n'}
               <span className="text-white">  email: </span><span className="text-green-300">'builder@startup.com'</span><span className="text-white">,</span>{'\n'}
               <span className="text-white">&#125;)</span>{'\n'}
               {'\n'}
               <span className="text-white/40">// Wallet instantly generated on Base network</span>{'\n'}
               <span className="text-blue-400">console</span><span className="text-white">.</span><span className="text-yellow-200">log</span><span className="text-white">(user.walletAddress)</span>{'\n'}
               <span className="text-white/40">// {'->'} 0xFfD2dF4aA86978A8971493B20287F5632bC0Fb5d</span>
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
      </main>
    </div>
  )
}
