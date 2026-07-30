# Request to Extend an Approved Off-Ramp Destination — Registered Merchant Tills and Billers

**To:** Bank of Tanzania — Regulatory Sandbox / National Payment Systems
**From:** NEDA Labs Limited
**Subject:** Proposed extension of the approved off-ramp to permit settlement to
registered merchant tills (Lipa Namba, including TANQR) and registered billers
**Classification:** Regulatory — Bank of Tanzania Sandbox Submission

---

## 1. Purpose

NEDA Labs requests confirmation that an approved off-ramp may settle to a
**registered merchant till or registered biller account** in addition to a
mobile money wallet.

We are not requesting a change to any approved Testing Parameter, an increase in
value at risk, a new payment service provider, or any change to the custody of
the reserve.

## 2. What the flow consists of

The flow has two legs. Each already operates in production under the Bank's
existing approval:

| Leg | Status |
| --- | --- |
| Inbound value converted to Tanzanian shillings and paid out | Operating under the approved off-ramp, settling to mobile money |
| Tanzanian shillings settled to a registered merchant till or biller | Operating as domestic customer payment, settled through our licensed payment service provider |

What is not yet permitted is joining them: directing an approved off-ramp's
shillings to the second destination instead of the first. It is a routing
decision applied to funds already moving through approved channels.

## 3. Position of the merchant

The merchant is paid in Tanzanian shillings, into the till or biller account
they already hold with our licensed payment service provider.

The merchant holds no digital asset at any point, opens no new account, and
makes no change to how they operate or reconcile. From the merchant's side the
settlement is indistinguishable from any other payment received through that
provider.

## 4. What we have built

The joined path is complete, tested, and deployed behind a control flag. It is
**not enabled**, and will not be enabled without the Bank's confirmation of the
terms under which it may operate.

Prospective deployment partner: a licensed digital payments provider that has
integrated our on-ramp and off-ramp. No merchant settlement has been executed
for any customer.

## 5. Design decision we wish to draw to the Bank's attention

Settlement to merchant tills and billers is already enabled for domestic
customer payments. The capability requested here uses the same rail and the
same provider, and could therefore have been implemented so that the existing
domestic permission governed it — placing cross-border settlement beyond a
separate decision by the Bank.

**We did not implement it that way.** The joined path is governed by its own
control, independent of the domestic one, so that enabling domestic bill payment
cannot enable cross-border merchant settlement as a side effect. Neither control
can be switched on by the other.

We mention this because it explains why we are before the Bank at all: the
constraint we have encountered is one we chose to keep.

## 6. Controls applying to merchant settlement

1. **Name disclosure.** The merchant's registered trading name is resolved and
   presented to the payer before authorisation. A payment cannot execute against
   a destination the payer has not been shown by name.
2. **Fee disclosure.** Every charge is itemised at quotation. The quotation is
   binding: execution charges exactly what was quoted, or does not execute.
3. **Destination binding.** The destination is fixed at quotation and cannot be
   substituted at execution.
4. **Single-use authorisation.** A quotation is consumed once and expires after
   sixty seconds.
5. **Testing parameters.** All approved parameters apply unchanged, per
   transaction and per participant. Every refusal is recorded.
6. **Reversal.** Where settlement fails, value is returned to its source
   automatically. A merchant is never partially paid.
7. **Reporting.** Settlement records enter the same reconciliation and daily
   reserve attestation the Bank already receives.
8. **Suspension.** The capability is governed by a single control. It can be
   withdrawn immediately, and doing so halts merchant settlement without
   affecting any other activity.

## 7. Proposed conditions

We propose to operate under whatever conditions the Bank considers appropriate,
and suggest the following:

1. **Approved Testing Parameters apply unchanged**, per transaction and per
   participant.
2. **Destinations limited to tills and billers already registered** with our
   licensed payment service provider. We introduce no merchants of our own.
3. **Separate reporting** in the periodic return: volume, value and counts by
   destination type, and any failed settlements, distinct from domestic
   activity.
4. **A defined initial period**, after which we report and the Bank determines
   whether it continues.
5. **Suspension on request**, effective immediately.

## 8. What the pilot would evidence

A supervised period would produce direct evidence on:

- settlement success rates and settlement times by destination type
- the proportion of inbound value reaching merchants directly rather than being
  converted and cashed out before purchase
- the cost to the payer compared with converting and cashing out
- whether merchants reconcile such settlements without difficulty

We would share this data with the Bank in full, including results that do not
support the proposition.

## 9. Requested next step

Confirmation that settlement of approved off-ramp value to a registered merchant
till or biller falls within the scope of our approved off-ramp on the conditions
above, together with any additional reporting or limits the Bank wishes to
attach.

We are able to demonstrate the flow end to end, including the authorisation
screen presented to the payer and the settlement record produced, at the Bank's
convenience.

---

**Contact**
NEDA Labs Limited
Victor A. Muhagachi, Chief Technology Officer
victor@nedapay.xyz
