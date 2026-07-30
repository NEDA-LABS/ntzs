# Request to test settlement of inbound digital-asset value directly to Tanzanian merchants

**From:** NEDA Labs Limited
**To:** Bank of Tanzania — Directorate of Financial Sector Supervision / Regulatory Sandbox
**Date:** [ ]
**Subject:** Request to extend approved off-ramp testing to include direct settlement to registered merchant tills and billers

---

## 1. What is being requested

We request approval to test one additional **destination** on an off-ramp flow the Bank has already approved.

Today, an approved off-ramp converts inbound value into Tanzanian shillings and pays a **mobile money wallet**. We are asking to also pay a **registered merchant till (Lipa Namba, including TANQR) or a registered biller account**, through our licensed payment service provider, exactly as any domestic customer payment is settled.

No new counterparty, no new rail, no new custody arrangement. The shillings originate from the same reserve, move through the same provider, and settle to a destination that provider already serves. The only change is who receives them.

## 2. Why it matters, stated plainly

A Tanzanian merchant accepting payment from a foreign visitor or a diaspora customer today has two options. The customer converts to shillings first, incurring a conversion cost and a cash-out fee before anything reaches the till. Or the merchant is paid outside the formal system entirely.

The second option is the one this request is really about. **The value is arriving in the country either way.** What is at stake is whether it arrives through a supervised, reported, name-verified channel with a settlement record, or through an informal one that leaves no trace.

Under the arrangement we are requesting:

- **The merchant is paid in shillings, into their existing registered till.** They hold no digital asset at any point, need no new account, and change nothing about how they operate.
- **Every payment is name-verified before it executes.** The payer is shown the merchant's registered trading name and the full fee breakdown, and must confirm.
- **Every payment produces a settlement record** in the same reconciliation and daily attestation the Bank already receives from us.

## 3. Consumer and merchant protection

The controls are the ones already operating on our domestic rails, unchanged:

| Control | How it applies here |
|---|---|
| **Name disclosure before payment** | The merchant's registered name is resolved and shown on the confirmation screen. A payment cannot execute against a destination the payer has not seen named. |
| **Full fee disclosure** | Every charge is itemised at quote time. The quote is binding — execution charges exactly what was quoted, or it does not execute. |
| **Destination binding** | The destination is fixed at quote time and cannot be substituted at execution. |
| **Single-use, expiring authorisation** | A quote is consumed once and expires in 60 seconds. |
| **Approved testing parameters** | All limits the Bank has approved apply unchanged, per transaction and per participant, and every refusal is recorded. |
| **Failed-payment reversal** | If settlement fails, value is returned to its source automatically. The merchant is never partially paid. |

## 4. What has already been built and held back

The capability is implemented, tested and deployed to production **behind a control that is switched off**, and has been since it was written. It is deliberately governed by a separate switch from our domestic merchant payments, so that enabling domestic bill payment cannot enable this by accident.

We are raising this before operating, not after. We would switch it on only on the Bank's written approval, and we would report on it in the periodic return for the period in which it operates.

We mention this because it is the same posture we have taken throughout: the constraint we have encountered is one we chose to keep.

## 5. Demand, and why we are asking now

A licensed digital payments provider has integrated our on-ramp and off-ramp and has asked specifically for merchant settlement — tills, TANQR and bills — for their own wallet customers. They have told us plainly that if this takes too long they will route the volume through another provider.

We think that is the more important sentence in this request. The demand exists and will be served. The question in front of the Bank is whether it is served through a supervised Tanzanian channel that reports to it, or through one that does not.

## 6. Proposed testing conditions

We propose to operate under whatever conditions the Bank considers appropriate, and suggest the following as a starting point:

1. **The approved per-transaction and per-participant limits apply unchanged.**
2. **Merchant destinations are limited to tills and billers already registered with our licensed payment service provider** — we introduce no merchants of our own.
3. **A dedicated line in the periodic return** covering volume, value, counts by destination type, and any failed settlements, separate from domestic activity.
4. **A defined initial test period**, after which we report and the Bank decides whether it continues.
5. **Immediate suspension on request** — the control is a single switch and takes effect at once.

## 7. What we would ask the Bank to confirm

- That settlement of inbound value to a registered merchant till or biller is within the scope of our approved off-ramp, on the conditions above; and
- Any additional reporting or limits the Bank wishes to attach.

We are happy to demonstrate the flow end to end, including the confirmation screen the payer sees and the settlement record it produces, at the Bank's convenience.

---

**[Name]**
Chief Executive Officer
NEDA Labs Limited
