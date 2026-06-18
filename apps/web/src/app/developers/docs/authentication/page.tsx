import { H1, Lead, H2, P, Code } from '../_components/ui'

export default function AuthenticationDocs() {
  return (
    <>
      <H1>Authentication</H1>
      <Lead>All API requests authenticate with your partner API key as a Bearer token.</Lead>

      <H2>API key</H2>
      <P>
        Find your key in the <strong>Settings</strong> section of the dashboard. Keep it secret —
        it can move money on capabilities you have enabled. Rotate it any time from Settings.
      </P>
      <Code>{`Authorization: Bearer ntzs_live_xxxxxxxxxxxxxxxxxxxx`}</Code>

      <H2>Base URL</H2>
      <Code>{`https://www.ntzs.co.tz/api/v1`}</Code>

      <H2>Example request</H2>
      <Code>{`curl https://www.ntzs.co.tz/api/v1/ramp/balance \\
  -H "Authorization: Bearer $NTZS_API_KEY"`}</Code>

      <H2>Idempotency</H2>
      <P>
        Money-moving endpoints accept an <code className="text-white/80">Idempotency-Key</code> header.
        Reuse the same key when retrying a request so an action is never performed twice.
      </P>
      <Code>{`-H "Idempotency-Key: 9f1c2b8a-..."`}</Code>

      <H2>Capabilities & KYB</H2>
      <P>
        Each endpoint requires a capability to be enabled on your account (e.g. <code className="text-white/80">ramp</code>).
        Money-moving capabilities also require approved KYB. Requests without the capability return
        <code className="text-white/80"> 403</code>; complete or request access from the dashboard.
      </P>

      <H2>Webhooks</H2>
      <P>
        Set a webhook URL + secret in the dashboard. We POST events (e.g. <code className="text-white/80">ramp.settlement.completed</code>)
        signed with HMAC-SHA256 in the <code className="text-white/80">X-Webhook-Signature</code> header — verify it as
        <code className="text-white/80"> hmac_sha256(timestamp + &quot;.&quot; + rawBody, secret)</code>.
      </P>
    </>
  )
}
