import LegalLayout from '../_components/legal-layout';

export const metadata = {
  title: 'Terms of Service — SimpleFX',
  description: 'Terms governing the use of SimpleFX, the open TZS liquidity market.',
};

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      subtitle="Legal"
      lastUpdated="30 March 2026"
    >
      <Section title="1. Acceptance of Terms">
        <p>By accessing or using SimpleFX (the &quot;Platform&quot;), operated by NEDA Labs Ltd., a company incorporated under the laws of the United Republic of Tanzania (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;), you agree to be bound by these Terms of Service (&quot;Terms&quot;). If you do not agree, do not use the Platform.</p>
        <p>These Terms are governed by and construed in accordance with the laws of the United Republic of Tanzania, including but not limited to the Electronic Transactions Act (Cap. 306, 2015), the Payment Systems Act (2015), and the Banking and Financial Institutions Act (2006, as amended).</p>
      </Section>

      <Section title="2. Platform Description">
        <p>SimpleFX is a non-custodial, on-chain liquidity provisioning platform that enables market makers (&quot;Liquidity Providers&quot; or &quot;LPs&quot;) to:</p>
        <ul>
          <li>Deposit nTZS (a tokenised representation of the Tanzanian Shilling) as inventory;</li>
          <li>Configure bid and ask spreads for automated order matching;</li>
          <li>Earn fees on cross-chain swap fills settled on supported blockchain networks including Base, Ethereum, Polygon, and Arbitrum.</li>
        </ul>
        <p>SimpleFX is not a bank, exchange, or payment service provider as defined under the Banking and Financial Institutions Act (Cap. 342) or the Payment Systems Act. The Platform facilitates peer-to-contract liquidity provisioning using smart contracts deployed on public blockchain networks.</p>
      </Section>

      <Section title="3. Eligibility">
        <p>You may only use SimpleFX if you:</p>
        <ul>
          <li>Are at least 18 years of age or the legal age of majority in your jurisdiction;</li>
          <li>Have full legal capacity to enter into a binding agreement;</li>
          <li>Are not a resident of, or subject to the laws of, any jurisdiction that prohibits your access to or use of the Platform;</li>
          <li>Are not a Politically Exposed Person (PEP) or subject to sanctions under any applicable international sanctions regime, including those administered by the United Nations, OFAC, or the United Kingdom;</li>
          <li>Have satisfactorily completed any applicable identity verification (KYC) procedures required by the Company.</li>
        </ul>
      </Section>

      <Section title="4. Know Your Customer (KYC) and Anti-Money Laundering (AML)">
        <p>In compliance with the Anti-Money Laundering Act (Cap. 423, 2006, as amended), the Proceeds of Crime Act (Cap. 256), and the Financial Intelligence Unit Act (Cap. 427) of Tanzania, as well as the Financial Action Task Force (FATF) Recommendations, the Company is required to:</p>
        <ul>
          <li>Verify the identity of all Liquidity Providers before activation of LP wallets;</li>
          <li>Monitor transactions for suspicious activity;</li>
          <li>Report suspicious transactions to the Financial Intelligence Unit of Tanzania (FIU-Tanzania) as required by law;</li>
          <li>Retain records of identification and transactions for a minimum of seven (7) years.</li>
        </ul>
        <p>By registering as an LP, you consent to the collection, processing, and verification of your personal and business information for these purposes.</p>
      </Section>

      <Section title="5. LP Wallet and Inventory">
        <p>Upon successful registration and KYC verification, the Company will provision an Externally Owned Account (EOA) wallet (&quot;LP Wallet&quot;) for your exclusive use on the Platform. You acknowledge that:</p>
        <ul>
          <li>The LP Wallet is a non-custodial smart contract wallet; the Company does not hold custody of your private keys in a manner that allows unilateral access to your funds;</li>
          <li>You are responsible for all activities conducted through your LP Wallet;</li>
          <li>The Company may suspend or restrict LP Wallet functionality in cases of suspected fraud, regulatory violation, or breach of these Terms;</li>
          <li>Depositing nTZS inventory constitutes an instruction to the Platform&apos;s smart contracts to make that inventory available for matching against incoming orders.</li>
        </ul>
      </Section>

      <Section title="6. Spreads, Fees, and Earnings">
        <p>LPs set their own bid and ask spreads within parameters configured by the Platform. The spread differential represents the LP&apos;s potential earnings on matched swaps. The Company may charge a protocol fee on filled orders, which will be disclosed in the Platform interface at the time of configuration.</p>
        <p>All fees and earnings are denominated and settled in the relevant token on-chain. The Company makes no representation as to the fiat-equivalent value of any tokens at any time.</p>
      </Section>

      <Section title="7. Risk Disclosure">
        <p>USE OF THE PLATFORM INVOLVES SIGNIFICANT RISK. By using SimpleFX, you acknowledge and accept the following risks:</p>
        <ul>
          <li><strong>Smart Contract Risk:</strong> The Platform relies on smart contracts that may contain bugs or vulnerabilities. The Company is not liable for losses arising from smart contract failures.</li>
          <li><strong>Regulatory Risk:</strong> The regulatory treatment of digital assets and tokenised currencies, including nTZS, is evolving. Future regulatory changes may restrict or prohibit your use of the Platform.</li>
          <li><strong>Market Risk:</strong> The value of digital assets is highly volatile. You may lose all inventory deposited.</li>
          <li><strong>Liquidity Risk:</strong> There is no guarantee that LP inventory will generate matched orders or earnings.</li>
          <li><strong>Technology Risk:</strong> Blockchain network congestion, oracle failures, or bridge vulnerabilities may affect Platform performance.</li>
          <li><strong>Foreign Exchange Risk:</strong> Cross-chain swaps involving assets denominated in foreign currencies are subject to exchange rate fluctuations governed in part by the Bank of Tanzania.</li>
        </ul>
      </Section>

      <Section title="8. Prohibited Activities">
        <p>You must not use the Platform to:</p>
        <ul>
          <li>Engage in money laundering, terrorist financing, or any activity prohibited under the Anti-Money Laundering Act (Cap. 423);</li>
          <li>Circumvent capital controls imposed by the Bank of Tanzania under the Foreign Exchange Act (Cap. 271);</li>
          <li>Conduct wash trading, front-running, or any form of market manipulation;</li>
          <li>Violate any applicable laws or regulations of the United Republic of Tanzania or any other applicable jurisdiction;</li>
          <li>Use automated bots or scripts in a manner that degrades Platform performance for other users;</li>
          <li>Impersonate any person or entity, or misrepresent your affiliation with any person or entity.</li>
        </ul>
        <p>Violations may result in immediate suspension of your LP Wallet and referral to relevant authorities including FIU-Tanzania and the Tanzania Police Force.</p>
      </Section>

      <Section title="9. Intellectual Property">
        <p>All content, software, trademarks, and intellectual property on the Platform are owned by or licensed to the Company. You are granted a limited, non-exclusive, non-transferable licence to use the Platform solely for its intended purpose. You may not copy, modify, distribute, or reverse-engineer any part of the Platform.</p>
      </Section>

      <Section title="10. Limitation of Liability">
        <p>TO THE MAXIMUM EXTENT PERMITTED BY TANZANIAN LAW, INCLUDING THE LIMITATION OF LIABILITY PRINCIPLES UNDER THE LAW OF CONTRACT ACT (CAP. 345), THE COMPANY AND ITS OFFICERS, DIRECTORS, AND EMPLOYEES SHALL NOT BE LIABLE FOR:</p>
        <ul>
          <li>Any indirect, incidental, special, consequential, or punitive damages;</li>
          <li>Loss of profits, revenue, data, or goodwill;</li>
          <li>Losses arising from smart contract vulnerabilities, blockchain network failures, or actions of third-party bridge protocols;</li>
          <li>Any loss or theft of digital assets resulting from your failure to maintain the security of your account credentials.</li>
        </ul>
      </Section>

      <Section title="11. Privacy">
        <p>The Company collects and processes personal data in accordance with its Privacy Policy and the Personal Data Protection Act (2022) of Tanzania. Please review the <a href="/simplefx/privacy" className="text-blue-400 hover:text-blue-300 underline">Privacy Policy</a> carefully before using the Platform.</p>
      </Section>

      <Section title="12. Modifications to Terms">
        <p>The Company reserves the right to modify these Terms at any time. Material changes will be communicated via the Platform or by email. Continued use of the Platform after the effective date of any modifications constitutes acceptance of the revised Terms.</p>
      </Section>

      <Section title="13. Governing Law and Dispute Resolution">
        <p>These Terms are governed by the laws of the United Republic of Tanzania. Any dispute arising out of or in connection with these Terms shall first be subject to good-faith negotiation. If unresolved within thirty (30) days, disputes shall be submitted to arbitration in Dar es Salaam, Tanzania, in accordance with the Arbitration Act (Cap. 15) and the rules of the Tanzania Institute of Arbitrators. The language of arbitration shall be English.</p>
        <p>Nothing in this clause prevents either party from seeking urgent injunctive relief from the High Court of Tanzania.</p>
      </Section>

      <Section title="14. Contact">
        <p>NEDA Labs Ltd.<br />Dar es Salaam, United Republic of Tanzania<br />Email: devops@ntzs.co.tz</p>
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
