/**
 * Selcom Business API — sandbox smoke test.
 *
 * Exercises the REAL adapter code path (processDisbursement in
 * apps/web/src/lib/psp/selcom.ts): builds the RSA-SHA256 signed request and
 * posts a disbursement to a Selcom sandbox test account.
 *
 * Two modes:
 *
 *   1. PROBE (no real signing key) — generates a throwaway keypair so the request
 *      is well-formed but the digest won't match the public key Selcom holds for
 *      your api-key. Expect an auth error (e.g. code 631 "digest mismatch").
 *      A 631 CONFIRMS base URL + api-key + header format are all correct.
 *
 *        SELCOM_API_KEY=<sandbox api-key> npx tsx scripts/test-selcom-sandbox.ts --probe
 *
 *   2. REAL — uses the RSA private key from the portal
 *      (API Credentials → Signing Keys → Regenerate Signing Key, copy the key).
 *      Completes an actual sandbox disbursement to the TESTWALLET account.
 *
 *        SELCOM_API_KEY=<sandbox api-key> \
 *        SELCOM_PRIVATE_KEY="$(cat selcom-sandbox-private.pem)" \
 *        SELCOM_DEFAULT_PURPOSE=<valid purpose code> \
 *          npx tsx scripts/test-selcom-sandbox.ts
 *
 * Target a rail with --target=wallet|bank|internal (default wallet), or --mobile
 * to route SELCOM_TEST_PHONE through sendPayout. SELCOM_DEBUG=1 prints raw HTTP.
 *
 * COLLECTIONS (--collect): pushes a USSD PIN prompt to SELCOM_TEST_PHONE and
 * polls pushussd-query. Runs against the CANONICAL sandbox (Dhimant, 14 Jul
 * 2026: sandbox = sandbox.selcom.business, prod = api.selcom.business/v1) —
 * pushussd exists there under our existing api-key. `--neda` instead targets
 * Selcom's internal dev box (sbsandbox.selcom.dev, needs separate creds,
 * disbursements under /v1/transaction/neda-pay — that path 404s on canonical).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import crypto from 'crypto'

// Match the app convention: .env first, .env.local overrides (SELCOM_* creds live there).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(repoRoot, '.env') })
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true })

// --neda: point defaults at Selcom's internal dev box (Postman collection env).
if (process.argv.includes('--neda')) {
  process.env.SELCOM_BIZ_BASE_URL ||= 'https://sbsandbox.selcom.dev'
  process.env.SELCOM_DISBURSE_PATH ||= '/v1/transaction/neda-pay'
  process.env.SELCOM_ACCOUNT_NUMBER ||= '5529100010951'
}

// Sandbox defaults (override via env).
process.env.SELCOM_BIZ_BASE_URL ||= 'https://sandbox.selcom.business'
process.env.SELCOM_ENV ||= 'sandbox'
process.env.SELCOM_DEFAULT_PURPOSE ||= 'FT' // generic funds-transfer code from the published Purpose Codes table
process.env.SELCOM_ACCOUNT_NUMBER ||= '13009 09436 454' // sandbox disbursement account (spaces stripped by the adapter)
process.env.SELCOM_UTILITY_REF ||= '255711410410' // ⚠ pushussd only; semantics unconfirmed — from Selcom's sample
process.env.SELCOM_DEBUG ||= '1'

// Sandbox test accounts (from the API Credentials page). Select with --target=.
const TEST_ACCOUNTS = {
  wallet: { recipientFiCode: 'TESTWALLET', recipientAccount: '5778600130859', recipientName: 'Sandbox Wallet' },
  bank: { recipientFiCode: 'TESTBANK', recipientAccount: '2085958308828', recipientName: 'Sandbox Bank' },
  internal: { recipientFiCode: 'SB2SELCOM', recipientAccount: '5906189574733', recipientName: 'Sandbox Selcom to Selcom' },
} as const

type TargetKey = keyof typeof TEST_ACCOUNTS

// Mobile payout recipient for the --mobile scenario (override via SELCOM_TEST_PHONE).
// Exercises normalize → wallet-FI-code routing → sign. Fully meaningful in
// production; in sandbox the endpoint validates against Selcom's own test
// accounts, so a live MSISDN may be rejected after the signature check passes.
const TEST_PHONE = process.env.SELCOM_TEST_PHONE || '0744277496'

const forceProbe = process.argv.includes('--probe')
const probe = forceProbe || !process.env.SELCOM_PRIVATE_KEY

if (probe) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  process.env.SELCOM_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  console.log('⚠  PROBE MODE — throwaway signing key. Expect an auth error (e.g. 631 digest mismatch).')
  console.log('   631 = base URL + api-key + header format are correct; only the key differs.\n')
}

async function main() {
  if (!process.env.SELCOM_API_KEY) {
    throw new Error('Set SELCOM_API_KEY to the sandbox api-key from the Selcom portal.')
  }

  // Import AFTER env is populated (selcom.ts reads env lazily at call time).
  const selcom = await import('../apps/web/src/lib/psp/selcom')

  console.log('Base URL:', process.env.SELCOM_BIZ_BASE_URL)

  // ── Collections scenario: push USSD to the test phone, then poll status ────
  if (process.argv.includes('--collect')) {
    console.log('Scenario: push-USSD collection → payer', TEST_PHONE, '| utilityRef', process.env.SELCOM_UTILITY_REF, '\n')
    const push = await selcom.initiatePayment({
      amountTzs: 100,
      phoneNumber: TEST_PHONE,
      customerEmail: 'test@nedapay.xyz',
      webhookUrl: '', // Selcom uses the portal-registered callback URL
      metadata: {},
    })
    console.log('\n=== Push result ===')
    console.log(JSON.stringify(push, null, 2))

    if (push.success && push.reference) {
      console.log('\n✅ Push initiated. transId:', push.reference, '| selcom ref:', push.externalReference ?? '(none)')
      console.log('Polling pushussd-query (the raw bodies reveal the paid-state field we still need to map)…')
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        const st = await selcom.checkPaymentStatus(push.reference)
        console.log(`  poll ${i + 1}:`, JSON.stringify(st))
        if (st.status !== 'pending') break
      }
      console.log('\nℹ️  Reminder: mapped status stays "pending" unless data.status shows an explicit paid marker — inspect the SELCOM_DEBUG raw bodies above and tighten the mapping in packages/psp/src/selcom.ts once the real paid payload is known.')
    } else if (probe) {
      console.log('\nℹ️  Probe complete — auth-stage error above confirms transport + headers.')
    }
    return
  }

  const mobile = process.argv.includes('--mobile')
  let res
  if (mobile) {
    console.log('Scenario: mobile sendPayout → recipientPhone', TEST_PHONE, '\n')
    res = await selcom.sendPayout({
      recipientPhone: TEST_PHONE,
      recipientName: 'nTZS test recipient',
      amountTzs: 100,
      narration: 'nTZS sandbox smoke test',
      webhookUrl: '', // Selcom uses the portal-registered callback URL, not per-request
      metadata: {},
    })
  } else {
    const targetArg = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] as TargetKey | undefined
    const target: TargetKey = targetArg && targetArg in TEST_ACCOUNTS ? targetArg : 'wallet'
    const account = TEST_ACCOUNTS[target]
    console.log(`Scenario: direct disbursement → ${target} (${account.recipientFiCode} ${account.recipientAccount})\n`)
    res = await selcom.processDisbursement({
      ...account,
      amountTzs: 100,
      narration: 'nTZS sandbox smoke test',
    })
  }

  console.log('\n=== Mapped result ===')
  console.log(JSON.stringify(res, null, 2))

  if (res.success && res.reference) {
    console.log('\n✅ Accepted. transId:', res.reference, '| receipt:', res.externalReference ?? '(none)')
    const status = await selcom.checkPayoutStatus(res.reference)
    console.log('Status query:', JSON.stringify(status, null, 2))

    // Regression: Balance + Statement APIs (require SELCOM_ACCOUNT_NUMBER).
    try {
      const bal = await selcom.getBalance()
      console.log('\nBalance:', JSON.stringify(bal, null, 2))
    } catch (e) {
      console.error('\n⚠ getBalance failed:', e instanceof Error ? e.message : e)
    }
    try {
      const stmt = await selcom.getStatement({ preset: 'Today', perPage: 5 })
      console.log('Statement (Today):', JSON.stringify({ ...stmt, transactions: `${stmt.transactions.length} row(s)` }, null, 2))
    } catch (e) {
      console.error('⚠ getStatement failed:', e instanceof Error ? e.message : e)
    }
  } else if (probe) {
    console.log('\nℹ️  Probe complete — see the raw response above to confirm the auth-stage error.')
  } else {
    console.log('\n❌ Disbursement failed:', res.error, res.errorCode ? `(code ${res.errorCode})` : '')
  }
}

main().catch((e) => {
  console.error('\n💥 Test crashed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
