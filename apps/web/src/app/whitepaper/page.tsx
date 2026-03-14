import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'

export const metadata: Metadata = {
  title: 'White Paper — nTZS',
  description:
    'Official white paper for nTZS, a Tanzanian Shilling-referenced digital token issued on the Base blockchain network by NEDA Labs Limited.',
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="mb-6 text-xl font-bold text-white border-b border-white/[0.07] pb-3">{title}</h2>
      <div className="space-y-6">{children}</div>
    </section>
  )
}

function SubSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24">
      <h3 className="mb-3 text-base font-semibold text-white/90">{title}</h3>
      <div className="text-sm leading-7 text-zinc-400 space-y-3">{children}</div>
    </div>
  )
}

function InfoTable({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value], i) => (
            <tr key={i} className="border-b border-white/[0.05] last:border-0">
              <td className="py-2.5 pr-6 align-top font-medium text-zinc-500 whitespace-nowrap w-48">{label}</td>
              <td className="py-2.5 text-zinc-300">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RiskTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.07] bg-white/[0.02]">
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 w-48">Risk</th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([risk, desc], i) => (
            <tr key={i} className="border-b border-white/[0.05] last:border-0">
              <td className="px-4 py-3 align-top font-medium text-zinc-300 whitespace-nowrap">{risk}</td>
              <td className="px-4 py-3 text-zinc-400 leading-6">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Callout({ variant, children }: { variant: 'warning' | 'info'; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-4 text-sm leading-7 ${
      variant === 'warning'
        ? 'border-amber-500/20 bg-amber-500/5 text-amber-200/80'
        : 'border-blue-500/20 bg-blue-500/5 text-blue-200/80'
    }`}>
      {children}
    </div>
  )
}

const toc = [
  { label: 'Summary', id: 'summary', children: [
    { label: 'S.1 — Characteristics of the token', id: 'S1' },
    { label: 'S.2 — Right of redemption', id: 'S2' },
    { label: 'S.3 — Key information about the offer', id: 'S3' },
  ]},
  { label: 'Part A — Issuer Information', id: 'partA', children: [
    { label: 'A.1 — Statutory name', id: 'A1' },
    { label: 'A.2 — Trading name', id: 'A2' },
    { label: 'A.3 — Legal form', id: 'A3' },
    { label: 'A.4 — Registered address', id: 'A4' },
    { label: 'A.5 — Contact information', id: 'A5' },
    { label: 'A.6 — Business activity', id: 'A6' },
    { label: 'A.7 — Conflicts of interest', id: 'A7' },
    { label: 'A.8 — Issuance of other crypto-assets', id: 'A8' },
    { label: 'A.9 — Financial condition', id: 'A9' },
  ]},
  { label: 'Part B — Token Information', id: 'partB', children: [
    { label: 'B.1 — Name', id: 'B1' },
    { label: 'B.2 — Abbreviation', id: 'B2' },
    { label: 'B.3 — Token type and classification', id: 'B3' },
    { label: 'B.4 — Smart contract details', id: 'B4' },
    { label: 'B.5 — Starting date of offer', id: 'B5' },
    { label: 'B.6 — Publication date', id: 'B6' },
    { label: 'B.7 — Website of the issuer', id: 'B7' },
  ]},
  { label: 'Part C — Information on the Offer', id: 'partC', children: [
    { label: 'C.1 — Public offering', id: 'C1' },
    { label: 'C.2 — Supply mechanism', id: 'C2' },
    { label: 'C.3 — Distribution channels', id: 'C3' },
    { label: 'C.4 — Applicable law', id: 'C4' },
  ]},
  { label: 'Part D — Rights and Obligations', id: 'partD', children: [
    { label: 'D.1 — Holder rights and obligations', id: 'D1' },
    { label: 'D.2 — Conditions of modification', id: 'D2' },
    { label: 'D.3 — Redemption rights', id: 'D3' },
    { label: 'D.4 — Token value protection', id: 'D4' },
    { label: 'D.5 — Complaint procedures', id: 'D5' },
    { label: 'D.6 — Dispute resolution', id: 'D6' },
  ]},
  { label: 'Part E — Underlying Technology', id: 'partE', children: [
    { label: 'E.1 — Distributed ledger technology', id: 'E1' },
    { label: 'E.2 — Protocols and technical standards', id: 'E2' },
    { label: 'E.3 — Smart contract architecture', id: 'E3' },
    { label: 'E.4 — Minting and burning mechanism', id: 'E4' },
    { label: 'E.5 — Security and access controls', id: 'E5' },
    { label: 'E.6 — Audit', id: 'E6' },
  ]},
  { label: 'Part F — Risks', id: 'partF', children: [
    { label: 'F.1 — Issuer-related risks', id: 'F1' },
    { label: 'F.2 — Token-related risks', id: 'F2' },
    { label: 'F.3 — Technology-related risks', id: 'F3' },
    { label: 'F.4 — Regulatory risks', id: 'F4' },
    { label: 'F.5 — Mitigation measures', id: 'F5' },
  ]},
  { label: 'Part G — Sustainability', id: 'partG', children: [
    { label: 'G.1 — Environmental impact', id: 'G1' },
  ]},
]

export default function WhitepaperPage() {
  return (
    <div className="min-h-screen bg-[#080810] text-white">
      {/* Top nav */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#080810]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/ntzs-logo.png" alt="nTZS" width={28} height={28} className="rounded-full" />
            <span className="text-sm font-semibold text-white">nTZS</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-zinc-500 sm:block">White Paper · Version 1.0 · March 2026</span>
            <Link
              href="/"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10"
            >
              Back to site
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-12 lg:flex lg:gap-12">
        {/* Sticky sidebar TOC — desktop only */}
        <aside className="hidden lg:block lg:w-72 lg:shrink-0">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-4">
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              Table of Contents
            </p>
            <nav className="space-y-1">
              {toc.map((group) => (
                <div key={group.id}>
                  <a
                    href={`#${group.id}`}
                    className="block py-1 text-xs font-semibold text-zinc-400 transition-colors hover:text-white"
                  >
                    {group.label}
                  </a>
                  {group.children.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className="block py-0.5 pl-3 text-[11px] text-zinc-600 transition-colors hover:text-zinc-300"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1">
          {/* Document header */}
          <div className="mb-12">
            <div className="mb-4 flex items-center gap-2">
              <Image src="/ntzs-logo.png" alt="nTZS" width={40} height={40} className="rounded-xl" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">NEDA Labs Limited</p>
                <p className="text-[10px] text-zinc-600">Version 1.0 — March 2026</p>
              </div>
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-white">nTZS White Paper</h1>
            <p className="mt-3 text-base text-zinc-400">
              Tanzanian Shilling-referenced digital token issued on the Base blockchain network.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {[
                ['Token', 'nTZS'],
                ['Network', 'Base (Chain ID: 8453)'],
                ['Standard', 'ERC-20'],
                ['Peg', '1 nTZS = 1 TZS'],
              ].map(([k, v]) => (
                <span key={k} className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs text-zinc-400">
                  <span className="text-zinc-600">{k}:</span> {v}
                </span>
              ))}
            </div>
          </div>

          {/* Statement */}
          <Callout variant="info">
            This white paper has been prepared by NEDA Labs Limited in connection with the issuance of nTZS, a Tanzanian Shilling-referenced token on the Base blockchain network. The information presented is fair, clear, and not misleading, and this white paper makes no omission likely to affect its import. NEDA Labs Limited is solely responsible for its content.
            <br /><br />
            This white paper does not constitute a prospectus or offer document under any applicable securities law. The nTZS token is not a security, investment product, or financial instrument.
          </Callout>

          <div className="mt-4">
            <Callout variant="warning">
              <strong className="font-semibold text-amber-300">Warning:</strong> The nTZS token is not covered by deposit guarantee schemes or investor compensation schemes. The value of nTZS is maintained through a reserve mechanism described in this white paper, but holders bear the risk of issuer insolvency, operational failure, or regulatory action. This white paper should be read in full before acquiring nTZS.
            </Callout>
          </div>

          <div className="mt-14 space-y-14">

            {/* SUMMARY */}
            <Section id="summary" title="Summary">
              <SubSection id="S1" title="S.1 — Characteristics of the Token">
                <p>
                  nTZS is a Tanzanian Shilling-referenced digital token issued on the Base blockchain network. For every nTZS token in circulation, NEDA Labs Limited holds one Tanzanian Shilling (TZS) or an equivalent amount of TZS-denominated reserve assets on behalf of holders, in order to facilitate the frictionless transfer, storage, and redemption of Tanzanian Shilling value using blockchain technology.
                </p>
                <p>
                  nTZS enables holders to send, receive, and store value denominated in Tanzanian Shillings without requiring a traditional bank account, while retaining the ability to redeem tokens for Tanzanian Shillings via mobile money at any time.
                </p>
              </SubSection>

              <SubSection id="S2" title="S.2 — Right of Redemption">
                <p>
                  Holders of nTZS have the right to redeem their tokens for Tanzanian Shillings at par value (1 nTZS = 1 TZS) at any time, subject to a minimum redemption amount of 5,000 TZS. Redemption is processed via mobile money disbursement to a registered Tanzanian phone number. Conditions and processes for redemption are detailed in Part D of this white paper.
                </p>
              </SubSection>

              <SubSection id="S3" title="S.3 — Key Information about the Offer">
                <InfoTable rows={[
                  ['Token name', 'nTZS'],
                  ['Ticker symbol', 'TZS'],
                  ['Blockchain network', 'Base (Coinbase L2, Ethereum)'],
                  ['Contract address', <code key="c" className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-zinc-300">0xF476BA983DE2F1AD532380630e2CF1D1b8b10688</code>],
                  ['Token standard', 'ERC-20'],
                  ['Decimals', '18'],
                  ['Peg', '1 nTZS = 1 Tanzanian Shilling (TZS)'],
                  ['Minimum redemption', '5,000 TZS'],
                  ['Redemption method', 'Mobile money (M-Pesa, Airtel Money, Tigo Pesa)'],
                  ['Issuer', 'NEDA Labs Limited'],
                  ['Website', <a key="w" href="https://www.ntzs.co.tz" className="text-blue-400 hover:underline">https://www.ntzs.co.tz</a>],
                ]} />
              </SubSection>
            </Section>

            {/* PART A */}
            <Section id="partA" title="Part A — Information About the Issuer">
              <SubSection id="A1" title="A.1 — Statutory Name"><p>NEDA Labs Limited</p></SubSection>
              <SubSection id="A2" title="A.2 — Trading Name"><p>NEDA Labs</p></SubSection>
              <SubSection id="A3" title="A.3 — Legal Form"><p>Private limited company incorporated under the laws of the United Republic of Tanzania.</p></SubSection>
              <SubSection id="A4" title="A.4 — Registered Address"><p>United Republic of Tanzania</p></SubSection>
              <SubSection id="A5" title="A.5 — Contact Information">
                <InfoTable rows={[
                  ['Website', <a key="w" href="https://www.ntzs.co.tz" className="text-blue-400 hover:underline">https://www.ntzs.co.tz</a>],
                  ['E-mail', <a key="e" href="mailto:devops@ntzs.co.tz" className="text-blue-400 hover:underline">devops@ntzs.co.tz</a>],
                  ['Response time', '1 business day'],
                ]} />
              </SubSection>
              <SubSection id="A6" title="A.6 — Business Activity">
                <p>
                  NEDA Labs Limited develops financial technology infrastructure for emerging markets. Its primary product is the nTZS token, a Tanzanian Shilling-referenced digital token, together with an API platform (WaaS — Wallet-as-a-Service) that enables third-party applications to issue, manage, and redeem nTZS wallets on behalf of their users.
                </p>
                <p>
                  The WaaS platform is provided to partner applications under a Partner Agreement and API key authentication scheme. Partner applications are responsible for the onboarding, identity verification, and compliance of their end users in accordance with applicable Tanzanian law.
                </p>
              </SubSection>
              <SubSection id="A7" title="A.7 — Conflicts of Interest Disclosure">
                <p>
                  NEDA Labs Limited and its management body are not aware of any conflicts of interest between their duties to holders of nTZS and their private interests or other duties that could materially affect the offering of nTZS.
                </p>
                <p>
                  The directors of NEDA Labs Limited hold an economic interest in the company. This interest is disclosed to ensure transparency. No director has a personal financial interest in the reserve assets held to back nTZS that is separate from their interest as shareholders of NEDA Labs Limited.
                </p>
              </SubSection>
              <SubSection id="A8" title="A.8 — Issuance of Other Crypto-Assets">
                <p>
                  As of the date of this white paper, NEDA Labs Limited does not issue any other crypto-asset. The company operates exclusively on the Base blockchain network for the nTZS token.
                </p>
              </SubSection>
              <SubSection id="A9" title="A.9 — Financial Condition">
                <p>
                  NEDA Labs Limited is a newly established entity. Reserve assets backing nTZS are held in segregated accounts and are not part of the general assets of NEDA Labs Limited. In the event of insolvency, reserve assets are earmarked for the redemption of outstanding nTZS tokens.
                </p>
              </SubSection>
            </Section>

            {/* PART B */}
            <Section id="partB" title="Part B — Information About the Token">
              <SubSection id="B1" title="B.1 — Name"><p>nTZS (read: &ldquo;digital Tanzanian Shilling&rdquo;)</p></SubSection>
              <SubSection id="B2" title="B.2 — Abbreviation"><p>TZS</p></SubSection>
              <SubSection id="B3" title="B.3 — Token Type and Classification">
                <p>
                  nTZS is a fiat-referenced token pegged to the Tanzanian Shilling (TZS), the official currency of the United Republic of Tanzania (ISO 4217: TZS). It is designed to maintain a stable value of 1 nTZS = 1 TZS at all times through a full reserve backing mechanism.
                </p>
                <p>
                  nTZS is an ERC-20 token deployed on the Base blockchain network. It is not a security, equity, debt instrument, or derivative. It confers no voting rights, profit participation rights, or ownership interest in NEDA Labs Limited.
                </p>
              </SubSection>
              <SubSection id="B4" title="B.4 — Smart Contract Details">
                <InfoTable rows={[
                  ['Network', 'Base (Chain ID: 8453)'],
                  ['Contract address', <code key="c" className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-zinc-300">0xF476BA983DE2F1AD532380630e2CF1D1b8b10688</code>],
                  ['Token standard', 'ERC-20'],
                  ['Decimals', '18'],
                  ['Explorer', <a key="e" href="https://basescan.org/token/0xF476BA983DE2F1AD532380630e2CF1D1b8b10688" target="_blank" rel="noopener noreferrer" className="break-all text-blue-400 hover:underline">basescan.org/token/0xF476BA983DE2F1AD...</a>],
                ]} />
                <p className="mt-4">The nTZS smart contract implements the following roles:</p>
                <ul className="list-none space-y-2 pl-0">
                  {[
                    ['DEFAULT_ADMIN_ROLE', 'Administrative control over role assignments and contract configuration. Held by NEDA Labs Limited\'s multi-signature treasury wallet.'],
                    ['MINTER_ROLE', 'Authority to mint new nTZS tokens in response to verified TZS deposits. Held by NEDA Labs Limited\'s minting infrastructure.'],
                    ['BURNER_ROLE', 'Authority to burn nTZS tokens on redemption. Held by NEDA Labs Limited\'s minting infrastructure.'],
                    ['PAUSER_ROLE', 'Authority to pause token transfers in an emergency. Held by NEDA Labs Limited.'],
                    ['FREEZER_ROLE', 'Authority to freeze individual addresses in cases of suspected fraud or regulatory requirement.'],
                  ].map(([role, desc]) => (
                    <li key={role} className="flex gap-3">
                      <code className="mt-0.5 shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 self-start">{role}</code>
                      <span>{desc}</span>
                    </li>
                  ))}
                </ul>
                <p>The contract includes a blacklist mechanism to comply with anti-money laundering obligations and a global pause mechanism for emergency situations.</p>
              </SubSection>
              <SubSection id="B5" title="B.5 — Starting Date of Offer"><p>The nTZS token was first offered to the public in March 2026 on the Base mainnet.</p></SubSection>
              <SubSection id="B6" title="B.6 — Publication Date"><p>March 2026</p></SubSection>
              <SubSection id="B7" title="B.7 — Website of the Issuer"><p><a href="https://www.ntzs.co.tz" className="text-blue-400 hover:underline">https://www.ntzs.co.tz</a></p></SubSection>
            </Section>

            {/* PART C */}
            <Section id="partC" title="Part C — Information on the Offer">
              <SubSection id="C1" title="C.1 — Public Offering">
                <p>
                  nTZS is offered to the public via the nTZS platform at <a href="https://www.ntzs.co.tz" className="text-blue-400 hover:underline">https://www.ntzs.co.tz</a> and through third-party partner applications that integrate the NEDA Labs WaaS API. Tokens are issued on a one-to-one basis in exchange for Tanzanian Shilling deposits made via the supported payment channels described in Section C.3.
                </p>
                <p>
                  There is no initial coin offering (ICO) or pre-sale of nTZS. Tokens are only minted upon receipt of corresponding TZS deposits and are always redeemable at par.
                </p>
              </SubSection>
              <SubSection id="C2" title="C.2 — Supply Mechanism">
                <p>
                  The supply of nTZS is not fixed. New tokens are minted exclusively in response to verified TZS deposits received by NEDA Labs Limited. Tokens are burned upon redemption. At all times, the total supply of nTZS in circulation is equal to or less than the total amount of TZS reserve assets held by NEDA Labs Limited.
                </p>
                <p>
                  There are no pre-minted tokens, team allocations, or reserve pools. Every nTZS in circulation is backed by a corresponding TZS reserve asset.
                </p>
              </SubSection>
              <SubSection id="C3" title="C.3 — Distribution Channels">
                <p>nTZS may be acquired through the following channels:</p>
                <ol className="list-decimal space-y-2 pl-5">
                  <li><strong className="text-zinc-300">Direct deposit</strong> — Users deposit Tanzanian Shillings via mobile money (M-Pesa, Airtel Money, Tigo Pesa) through the nTZS platform. Upon confirmation of the deposit, nTZS tokens are minted to the user's wallet address.</li>
                  <li><strong className="text-zinc-300">Partner applications</strong> — Third-party applications using the NEDA Labs WaaS API may facilitate nTZS issuance on behalf of their users, subject to completion of applicable identity verification requirements.</li>
                  <li><strong className="text-zinc-300">Peer-to-peer transfer</strong> — Existing nTZS holders may transfer tokens directly to any valid Base network address using standard ERC-20 transfer functionality.</li>
                </ol>
              </SubSection>
              <SubSection id="C4" title="C.4 — Applicable Law">
                <p>
                  This white paper and the nTZS token are subject to the laws of the United Republic of Tanzania. Any dispute arising in connection with nTZS shall be subject to the jurisdiction of the courts of Tanzania, unless otherwise agreed in writing.
                </p>
              </SubSection>
            </Section>

            {/* PART D */}
            <Section id="partD" title="Part D — Rights and Obligations">
              <SubSection id="D1" title="D.1 — Holder Rights and Obligations">
                <p className="font-medium text-zinc-300">Rights of holders:</p>
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>The right to hold, transfer, and redeem nTZS tokens at any time, subject to the minimum redemption threshold of 5,000 TZS.</li>
                  <li>The right to redeem nTZS at par value (1 nTZS = 1 TZS) via mobile money to a registered Tanzanian phone number.</li>
                  <li>The right to transfer nTZS to any valid blockchain address without restriction, subject to the absence of a freeze or blacklist on the sending address.</li>
                  <li>The right to submit complaints and access a dispute resolution mechanism as described in Sections D.5 and D.6.</li>
                </ul>
                <p className="mt-4 font-medium text-zinc-300">Obligations of holders:</p>
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>Holders must not use nTZS for any illegal purpose, including money laundering, terrorist financing, or sanctions evasion.</li>
                  <li>Holders who access nTZS through a partner application are subject to the terms and conditions of that partner application, including any identity verification requirements.</li>
                  <li>Holders must provide accurate redemption details (phone number, name) to receive mobile money payouts.</li>
                </ul>
              </SubSection>
              <SubSection id="D2" title="D.2 — Conditions of Modification">
                <p>
                  NEDA Labs Limited reserves the right to modify the terms governing nTZS, including the minimum redemption amount, supported redemption channels, and fee structure. Material modifications will be communicated to holders via the nTZS website with a minimum of 30 days notice, except where modification is required by law or to protect the security of the reserve.
                </p>
              </SubSection>
              <SubSection id="D3" title="D.3 — Redemption Rights">
                <p>Holders may redeem nTZS tokens for Tanzanian Shillings at any time via the following process:</p>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>The holder initiates a withdrawal request via the nTZS platform or a partner application, specifying the amount (minimum 5,000 TZS) and the destination mobile money number.</li>
                  <li>NEDA Labs Limited verifies the holder&apos;s on-chain balance and the validity of the redemption request.</li>
                  <li>The corresponding nTZS tokens are burned on the Base blockchain.</li>
                  <li>The equivalent TZS amount is disbursed to the holder&apos;s mobile money account within 1 business day.</li>
                </ol>
                <p>
                  Redemption requests below 5,000 TZS will not be processed. There is no maximum redemption amount, though requests exceeding 100,000 TZS may require additional identity verification before processing.
                </p>
                <p>Redemption fees, if any, will be disclosed on the nTZS website prior to transaction completion.</p>
              </SubSection>
              <SubSection id="D4" title="D.4 — Token Value Protection">
                <p>The value of nTZS is maintained through the following reserve mechanism:</p>
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>For every nTZS token in circulation, NEDA Labs Limited holds one Tanzanian Shilling or equivalent liquid asset in a segregated reserve account.</li>
                  <li>Reserve assets are not commingled with NEDA Labs Limited&apos;s operational funds.</li>
                  <li>Reserve balances are verifiable on-chain by comparing the total supply of nTZS (publicly readable from the smart contract) against reserve attestation reports published periodically by NEDA Labs Limited.</li>
                </ul>
              </SubSection>
              <SubSection id="D5" title="D.5 — Complaint Procedures">
                <p>
                  Holders may submit complaints to NEDA Labs Limited by e-mail at <a href="mailto:hello@ntzs.co.tz" className="text-blue-400 hover:underline">hello@ntzs.co.tz</a>. Complaints will be acknowledged within 2 business days and resolved within 10 business days. Where a complaint cannot be resolved within 10 business days, the holder will be notified of the expected timeline for resolution.
                </p>
              </SubSection>
              <SubSection id="D6" title="D.6 — Dispute Resolution">
                <p>
                  Any dispute arising from the holding or redemption of nTZS that cannot be resolved through the complaint procedure described in Section D.5 shall be referred to mediation under the rules of the Tanzania Institute of Arbitrators, and failing resolution, to the courts of Tanzania.
                </p>
              </SubSection>
            </Section>

            {/* PART E */}
            <Section id="partE" title="Part E — Underlying Technology">
              <SubSection id="E1" title="E.1 — Distributed Ledger Technology">
                <p>
                  nTZS is issued on <strong className="text-zinc-300">Base</strong>, a Layer 2 blockchain network developed and operated by Coinbase Technologies Inc. Base is built on the OP Stack and settles transactions to the Ethereum mainnet, inheriting Ethereum&apos;s security guarantees through its fraud proof mechanism.
                </p>
                <p>Base was selected as the issuance network for nTZS due to its:</p>
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>Low transaction fees (typically below $0.01 per transfer)</li>
                  <li>High throughput and fast transaction finality</li>
                  <li>Ethereum compatibility and access to existing developer tooling</li>
                  <li>Institutional backing and long-term operational commitment from Coinbase</li>
                </ul>
              </SubSection>
              <SubSection id="E2" title="E.2 — Protocols and Technical Standards">
                <RiskTable rows={[
                  ['ERC-20', 'Token interface standard for fungible tokens on EVM-compatible networks'],
                  ['EIP-1193', 'Ethereum provider API for wallet connectivity'],
                  ['OpenZeppelin', 'Audited smart contract library used for access control, pausability, and ERC-20 base implementation'],
                  ['BIP-39 / BIP-44', 'Hierarchical deterministic wallet derivation standard used for WaaS user wallets'],
                  ['AES-256-GCM', 'Encryption standard used to protect HD wallet seeds at rest'],
                ]} />
              </SubSection>
              <SubSection id="E3" title="E.3 — Smart Contract Architecture">
                <p>The nTZS smart contract is derived from the OpenZeppelin ERC-20 implementation with the following extensions:</p>
                <ul className="list-none space-y-2 pl-0">
                  {[
                    ['AccessControl', 'Role-based permissioning system governing mint, burn, pause, freeze, and blacklist operations.'],
                    ['Pausable', 'Emergency pause functionality that halts all token transfers when activated.'],
                    ['Blacklist', 'Address-level restriction mechanism for regulatory compliance.'],
                    ['Freeze', 'Address-level balance freeze that prevents the transfer of funds from a specific address pending investigation or legal hold.'],
                    ['Wipe', 'Administrative function permitting the removal of frozen balances in cases of confirmed fraud or court order.'],
                  ].map(([name, desc]) => (
                    <li key={name} className="flex gap-3">
                      <strong className="mt-0.5 shrink-0 text-zinc-300 self-start">{name}</strong>
                      <span>{desc}</span>
                    </li>
                  ))}
                </ul>
                <p>All administrative actions are logged to the blockchain and auditable by any observer.</p>
              </SubSection>
              <SubSection id="E4" title="E.4 — Minting and Burning Mechanism">
                <p className="font-medium text-zinc-300">Minting occurs when a user deposits Tanzanian Shillings via a supported payment channel:</p>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>The user initiates a deposit via the nTZS platform or a partner application.</li>
                  <li>NEDA Labs Limited&apos;s payment processor confirms receipt of the TZS deposit.</li>
                  <li>The minting service calls the <code className="rounded bg-white/[0.06] px-1 font-mono text-xs text-zinc-300">mint(address to, uint256 amount)</code> function on the nTZS contract using a wallet holding the MINTER_ROLE.</li>
                  <li>An equivalent number of nTZS tokens are created and credited to the user&apos;s wallet address.</li>
                </ol>
                <p className="mt-4 font-medium text-zinc-300">Burning occurs when a user initiates a redemption:</p>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>The user requests a withdrawal via the nTZS platform or a partner application.</li>
                  <li>The platform verifies the user&apos;s on-chain balance and redemption details.</li>
                  <li>The burning service calls the <code className="rounded bg-white/[0.06] px-1 font-mono text-xs text-zinc-300">burn(address from, uint256 amount)</code> function using a wallet holding the BURNER_ROLE.</li>
                  <li>The corresponding nTZS tokens are destroyed, reducing the total supply.</li>
                  <li>The mobile money disbursement is initiated via NEDA Labs Limited&apos;s payout partner.</li>
                </ol>
              </SubSection>
              <SubSection id="E5" title="E.5 — Security and Access Controls">
                <p className="font-medium text-zinc-300">Wallet architecture:</p>
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>Each partner application is issued an isolated HD wallet seed, encrypted using AES-256-GCM and stored in the NEDA Labs database.</li>
                  <li>User wallets are derived deterministically from the partner seed using the BIP-44 derivation path <code className="rounded bg-white/[0.06] px-1 font-mono text-xs text-zinc-300">m/44&apos;/8453&apos;/0&apos;/0/&#123;walletIndex&#125;</code>.</li>
                  <li>Private keys are derived on-demand for transaction signing and are never persisted to disk or database.</li>
                </ul>
                <p className="mt-4 font-medium text-zinc-300">Minting infrastructure:</p>
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>The MINTER_ROLE and BURNER_ROLE are held by a dedicated server-side wallet used exclusively for mint and burn operations.</li>
                  <li>Administrative roles (PAUSER_ROLE, FREEZER_ROLE, DEFAULT_ADMIN_ROLE) are held by a multi-signature treasury wallet requiring multiple signatories for any administrative action.</li>
                </ul>
              </SubSection>
              <SubSection id="E6" title="E.6 — Audit">
                <p>
                  The nTZS smart contract is based on audited OpenZeppelin contracts. NEDA Labs Limited intends to commission an independent third-party audit of the nTZS smart contract and reserve management procedures. The results of any completed audit will be published on the nTZS website.
                </p>
              </SubSection>
            </Section>

            {/* PART F */}
            <Section id="partF" title="Part F — Risks">
              <SubSection id="F1" title="F.1 — Issuer-Related Risks">
                <RiskTable rows={[
                  ['Insolvency', 'NEDA Labs Limited is a newly established company with a limited operating history. In the event of insolvency, reserve assets are held separately from operational funds; however, holders may face delays in accessing redemption proceeds during insolvency proceedings.'],
                  ['Operational failure', "NEDA Labs Limited's minting and redemption infrastructure may be subject to downtime, technical failures, or cyberattacks, which may temporarily prevent minting or redemption."],
                  ['Key person risk', 'The operation of nTZS depends on a small team. Loss of key personnel could affect operations.'],
                  ['Regulatory action', 'NEDA Labs Limited may be subject to regulatory orders, investigations, or sanctions that could restrict or halt operations.'],
                ]} />
              </SubSection>
              <SubSection id="F2" title="F.2 — Token-Related Risks">
                <RiskTable rows={[
                  ['Reserve shortfall', 'A failure in the reserve management process could result in nTZS tokens outstanding exceeding reserve assets, impairing the ability to honour redemptions at par.'],
                  ['Smart contract risk', 'Undiscovered vulnerabilities in the nTZS smart contract could be exploited to create unauthorised tokens or destroy holder balances.'],
                  ['Blacklist / freeze', "A holder's address may be frozen or blacklisted following a regulatory order or confirmed fraud investigation, preventing transfer or redemption of affected balances."],
                  ['Peg stability', 'While nTZS is designed to maintain a 1:1 peg with TZS, secondary market trading, if any, may result in prices above or below par. NEDA Labs Limited does not guarantee the secondary market price of nTZS.'],
                ]} />
              </SubSection>
              <SubSection id="F3" title="F.3 — Technology-Related Risks">
                <RiskTable rows={[
                  ['Network congestion', 'High transaction volumes on the Base network may cause delays in transaction confirmation.'],
                  ['Base network failure', 'As nTZS is issued on the Base network, any failure, hard fork, or discontinuation of the Base network could affect the functionality of nTZS.'],
                  ['Wallet loss', 'Holders who control their own private keys and lose access to those keys will be unable to recover their nTZS balance. NEDA Labs Limited is unable to recover private keys on behalf of self-custody holders.'],
                  ['Mobile money failure', 'Redemption depends on third-party mobile money operators. Failure or outage of a mobile money provider may delay redemption disbursements.'],
                ]} />
              </SubSection>
              <SubSection id="F4" title="F.4 — Regulatory Risks">
                <p>
                  nTZS is issued by a Tanzanian company and is primarily intended for use within Tanzania. The regulatory treatment of digital tokens in Tanzania is evolving. NEDA Labs Limited is subject to applicable Tanzanian laws and regulations, including those governing electronic money, payment services, and anti-money laundering obligations.
                </p>
                <p>
                  Changes to the regulatory environment in Tanzania, or the application of regulations in other jurisdictions where nTZS may be held or transferred, may require modifications to the nTZS platform or, in extreme cases, the suspension of nTZS issuance or redemption.
                </p>
              </SubSection>
              <SubSection id="F5" title="F.5 — Mitigation Measures">
                <RiskTable rows={[
                  ['Reserve shortfall', 'Reserve assets are held in segregated accounts. Total supply is publicly verifiable on-chain at all times.'],
                  ['Smart contract vulnerability', 'Contract is based on audited OpenZeppelin libraries. Third-party audit is planned. Emergency pause mechanism allows operations to be halted immediately.'],
                  ['Operational failure', 'Redundant infrastructure and monitoring. Burn requests are queued in a persistent database and retried automatically.'],
                  ['Key person risk', 'Operational procedures are documented. Administrative actions require multi-signature approval.'],
                  ['Regulatory change', 'NEDA Labs Limited monitors regulatory developments and maintains dialogue with relevant authorities.'],
                ]} />
              </SubSection>
            </Section>

            {/* PART G */}
            <Section id="partG" title="Part G — Sustainability">
              <SubSection id="G1" title="G.1 — Environmental Impact">
                <p>
                  nTZS is issued on Base, a Layer 2 blockchain that settles transactions to Ethereum. Following Ethereum&apos;s transition to Proof-of-Stake consensus in September 2022, the energy consumption of Ethereum and its Layer 2 networks has been reduced by approximately 99.95% relative to the prior Proof-of-Work model.
                </p>
                <p>
                  The energy consumption associated with nTZS transactions is negligible relative to traditional financial infrastructure. NEDA Labs Limited does not operate any mining infrastructure and does not contribute to Proof-of-Work energy consumption.
                </p>
                <p>
                  NEDA Labs Limited is committed to operating its infrastructure on renewable energy where available and will assess its carbon footprint as the business scales.
                </p>
              </SubSection>
            </Section>

            {/* Legal Notice */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-6 text-xs leading-6 text-zinc-500">
              <p className="mb-2 font-semibold text-zinc-400">Legal Notice</p>
              <p>
                This white paper is published by NEDA Labs Limited for informational purposes only. It does not constitute financial advice, investment advice, or a recommendation to acquire nTZS. Prospective holders should conduct their own due diligence and, where appropriate, seek independent legal, financial, and tax advice before acquiring nTZS.
              </p>
              <p className="mt-3">
                The information in this white paper is current as of the date of publication. NEDA Labs Limited reserves the right to update this white paper to reflect material changes to the nTZS token, its terms, or applicable regulations. The current version of this white paper is available at{' '}
                <a href="https://www.ntzs.co.tz/whitepaper" className="text-zinc-400 hover:underline">https://www.ntzs.co.tz/whitepaper</a>.
              </p>
              <p className="mt-4 border-t border-white/[0.05] pt-4">
                NEDA Labs Limited · <a href="https://www.ntzs.co.tz" className="hover:underline">https://www.ntzs.co.tz</a> · <a href="mailto:devops@ntzs.co.tz" className="hover:underline">devops@ntzs.co.tz</a> · Version 1.0 — March 2026
              </p>
            </div>

          </div>
        </main>
      </div>
    </div>
  )
}
