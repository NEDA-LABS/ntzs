import LegalLayout from '@/components/ui/legal-layout';

export const metadata = {
  title: 'Privacy Policy — SimpleFX',
  description: 'How SimpleFX collects, uses, and protects your personal data.',
};

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      subtitle="Legal"
      lastUpdated="30 March 2026"
    >
      <Section title="1. Introduction">
        <p>NEDA Labs Ltd. (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;) operates SimpleFX. This Privacy Policy explains how we collect, use, store, and protect your personal data when you use the Platform. It applies to all Liquidity Providers and visitors.</p>
        <p>This Policy is issued in compliance with the <strong>Personal Data Protection Act, 2022 (Tanzania)</strong>, the <strong>Electronic and Postal Communications Act (Cap. 306, 2010)</strong>, and, where applicable, the principles of the European Union General Data Protection Regulation (GDPR) for data subjects located in the European Economic Area.</p>
      </Section>

      <Section title="2. Data Controller">
        <p>The data controller responsible for your personal data is:</p>
        <p>
          NEDA Labs Ltd.<br />
          Dar es Salaam, United Republic of Tanzania<br />
          Email: devops@ntzs.co.tz
        </p>
      </Section>

      <Section title="3. Data We Collect">
        <p>We may collect and process the following categories of personal data:</p>
        <ul>
          <li><strong>Identity Data:</strong> Full legal name, date of birth, nationality, government-issued identification number (e.g. NIDA, passport, driving licence).</li>
          <li><strong>Contact Data:</strong> Email address, telephone number, physical address.</li>
          <li><strong>Financial Data:</strong> Blockchain wallet addresses, transaction history on the Platform, deposited inventory amounts, earned fees.</li>
          <li><strong>KYC/AML Data:</strong> Copies of identification documents, proof of address, source of funds declarations, and any enhanced due diligence data required under the Anti-Money Laundering Act (Cap. 423).</li>
          <li><strong>Technical Data:</strong> IP address, browser type and version, device identifiers, operating system, time zone, referring URLs, and Platform usage data collected via cookies and analytics.</li>
          <li><strong>Communications Data:</strong> Records of correspondence with us, including support requests.</li>
        </ul>
        <p>We do not collect special categories of sensitive personal data (such as biometric data for identification purposes) except where required by applicable KYC/AML obligations.</p>
      </Section>

      <Section title="4. Legal Basis for Processing">
        <p>We process your personal data on the following legal bases under the Personal Data Protection Act, 2022 and, where applicable, GDPR:</p>
        <ul>
          <li><strong>Contract Performance:</strong> Processing necessary to provide you with the Platform and LP Wallet services.</li>
          <li><strong>Legal Obligation:</strong> Processing required to comply with Tanzanian law, including KYC/AML obligations under the Anti-Money Laundering Act (Cap. 423), the Financial Intelligence Unit Act (Cap. 427), and reporting obligations to the Bank of Tanzania and FIU-Tanzania.</li>
          <li><strong>Legitimate Interests:</strong> Processing for fraud prevention, Platform security, and product improvement, where such interests are not overridden by your rights.</li>
          <li><strong>Consent:</strong> Where you have given specific, informed consent, including for optional marketing communications. You may withdraw consent at any time.</li>
        </ul>
      </Section>

      <Section title="5. How We Use Your Data">
        <p>We use your personal data to:</p>
        <ul>
          <li>Verify your identity and complete KYC/AML screening;</li>
          <li>Create and manage your LP Wallet;</li>
          <li>Process and record transactions on the Platform;</li>
          <li>Detect, investigate, and prevent fraud, money laundering, and other illegal activities;</li>
          <li>Comply with legal obligations and respond to requests from FIU-Tanzania, the Bank of Tanzania, or other competent authorities;</li>
          <li>Communicate with you about your account, Platform updates, and changes to these policies;</li>
          <li>Improve the Platform through aggregated, anonymised analytics;</li>
          <li>Send marketing communications where you have consented.</li>
        </ul>
      </Section>

      <Section title="6. Data Sharing and Disclosure">
        <p>We do not sell your personal data. We may share your data with:</p>
        <ul>
          <li><strong>Regulatory Authorities:</strong> FIU-Tanzania, the Bank of Tanzania, the Tanzania Revenue Authority (TRA), and law enforcement agencies where required by law or court order;</li>
          <li><strong>KYC/AML Service Providers:</strong> Third-party identity verification and sanctions screening providers operating under appropriate data processing agreements;</li>
          <li><strong>Cloud Infrastructure Providers:</strong> Hosting and database providers (including those outside Tanzania) subject to adequate data transfer safeguards;</li>
          <li><strong>Professional Advisers:</strong> Lawyers, auditors, and insurers bound by professional confidentiality obligations;</li>
          <li><strong>Business Successors:</strong> In the event of a merger, acquisition, or asset sale, subject to the same privacy commitments.</li>
        </ul>
        <p>Any international transfer of personal data is conducted in compliance with the cross-border transfer provisions of the Personal Data Protection Act, 2022, including the use of standard contractual clauses or adequacy determinations where applicable.</p>
      </Section>

      <Section title="7. Data Retention">
        <p>We retain your personal data for as long as necessary to fulfil the purposes for which it was collected, including:</p>
        <ul>
          <li>A minimum of <strong>seven (7) years</strong> after the termination of your LP account, as required by the Anti-Money Laundering Act (Cap. 423) and the Electronic Transactions Act (2015);</li>
          <li>For the duration of any ongoing legal proceedings or regulatory investigations;</li>
          <li>As otherwise required by applicable Tanzanian law.</li>
        </ul>
        <p>After the applicable retention period, data is securely deleted or anonymised.</p>
      </Section>

      <Section title="8. Your Rights">
        <p>Under the Personal Data Protection Act, 2022, you have the following rights in respect of your personal data:</p>
        <ul>
          <li><strong>Right of Access:</strong> To request a copy of the personal data we hold about you;</li>
          <li><strong>Right to Rectification:</strong> To request correction of inaccurate or incomplete data;</li>
          <li><strong>Right to Erasure:</strong> To request deletion of your data, subject to our legal retention obligations;</li>
          <li><strong>Right to Restriction:</strong> To request that we restrict processing of your data in certain circumstances;</li>
          <li><strong>Right to Object:</strong> To object to processing based on legitimate interests;</li>
          <li><strong>Right to Data Portability:</strong> To receive your data in a structured, machine-readable format where technically feasible;</li>
          <li><strong>Right to Withdraw Consent:</strong> Where processing is based on consent, to withdraw it at any time without affecting the lawfulness of prior processing.</li>
        </ul>
        <p>To exercise any of these rights, please contact us at devops@ntzs.co.tz. We will respond within thirty (30) days. You also have the right to lodge a complaint with the Personal Data Protection Commission of Tanzania.</p>
      </Section>

      <Section title="9. Cookies and Tracking">
        <p>The Platform uses essential cookies necessary for its operation (e.g. session management) and, with your consent, analytics cookies to understand usage patterns. We do not use third-party advertising cookies. You may manage cookie preferences through your browser settings. Disabling essential cookies may impair Platform functionality.</p>
      </Section>

      <Section title="10. Security">
        <p>We implement industry-standard technical and organisational security measures including AES-256 encryption for sensitive stored data, TLS 1.3 for data in transit, access controls, and regular security audits. However, no method of electronic transmission or storage is completely secure, and we cannot guarantee absolute security.</p>
        <p>In the event of a personal data breach that is likely to result in high risk to your rights and freedoms, we will notify you and the Personal Data Protection Commission without undue delay, as required by the Personal Data Protection Act, 2022.</p>
      </Section>

      <Section title="11. Children">
        <p>The Platform is not directed at persons under the age of 18. We do not knowingly collect personal data from minors. If we become aware that we have inadvertently collected such data, we will delete it promptly.</p>
      </Section>

      <Section title="12. Changes to This Policy">
        <p>We may update this Privacy Policy from time to time. Material changes will be communicated via the Platform or by email. The &quot;Last updated&quot; date at the top of this Policy indicates when it was last revised.</p>
      </Section>

      <Section title="13. Contact">
        <p>For any privacy-related queries or to exercise your data rights:</p>
        <p>
          Data Protection Officer<br />
          NEDA Labs Ltd.<br />
          Dar es Salaam, United Republic of Tanzania<br />
          Email: devops@ntzs.co.tz
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
