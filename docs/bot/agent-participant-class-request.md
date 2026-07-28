# Request for a Variation to Testing Parameters — Agent Participant Class

**To:** Bank of Tanzania — Regulatory Sandbox / National Payment Systems
**From:** NEDA Labs Limited
**Subject:** Proposed variation to Testing Parameters #2, #3 and #4 to permit a
supervised pilot with mobile-money agents (wakala)
**Classification:** Regulatory — Bank of Tanzania Sandbox Submission

---

## 1. Purpose

NEDA Labs requests a variation to the approved Testing Parameters to permit a
ring-fenced pilot in which **mobile-money agents** participate as a distinct
class, with limits calibrated to a small business rather than an individual
consumer.

We are not requesting a change to the general consumer parameters, and we are
not requesting an increase in the overall value at risk beyond what is set out
in Section 6.

## 2. The problem observed in the market

A wakala serves customers from two pools of liquidity: cash in the drawer, and
electronic float held separately with each provider. Their working day is
constrained less by demand than by the composition of that float.

Field observation (Dar es Salaam, 27 July 2026) of an operating agent recorded:

| Measure | Observed |
| --- | --- |
| Agent commission, 50,000 TZS cash-out | 322 TZS |
| Agent commission, 50,000 TZS cash-in | 295 TZS |

At those margins an agent must transact continuously to be viable, and every
interruption is lost income. The interruption we set out to address is not the
movement of float between networks — the Tanzania Instant Payment System has
made that fast and free, and we do not seek to duplicate it. It is the
transactions an agent **cannot** offer at all from a single balance: utility
bills, Government e-Payment Gateway control numbers, bank transfers, and
merchant payments across networks. Each is revenue foregone by the agent and a
service the customer must seek elsewhere.

## 3. What we have built

A capability enabling a licensed payment service provider to give each of its
agents **one digital float** which can settle to any mobile wallet, any
merchant till on any network, and any biller — from a single balance.

The capability is complete, tested, and deployed behind a control flag. It is
**not enabled**, and will not be enabled without the Bank's agreement to the
parameters under which it would operate.

Prospective deployment partner: a licensed payment service provider operating
an agent management platform in Tanzania. No agent has been onboarded.

## 4. How the current parameters bind

The approved parameters apply per participant:

| Parameter | Approved value |
| --- | --- |
| #2 — Participants | 100 |
| #3 — Per transaction | 1,000,000 TZS |
| #4 — Per participant, per day | 2,000,000 TZS |
| #5 — Per participant, 30 days | 60,000,000 TZS |

An agent transacting fifty times a day at 50,000 TZS turns over 2,500,000 TZS —
exceeding the daily parameter before midday. The parameters are calibrated for
an individual consumer, which is correct for consumers and simply does not
describe an agent's activity.

## 5. Design decision we wish to draw to the Bank's attention

Each agent float is held in a sub-account beneath the partner's account. Such
sub-accounts sit outside the per-participant counting used for individual
users, and could therefore have been implemented in a way that placed agent
volume beyond the approved limits without any parameter change.

**We did not implement it that way.** Every disbursement records the float that
funded it, and the same daily and monthly ceilings are counted against each
float exactly as they are against an individual. Provisioning a second float
creates another participant against Parameter #2; it does not create additional
headroom. This is enforced in code and verified by an automated test that fails
our build if any future change counts a float's activity against anything other
than itself.

We mention this because it explains why we are before the Bank at all: the
constraint we have encountered is one we chose to keep.

## 6. Requested variation

We propose an **agent participant class**, applying only to floats operated by
agents of a licensed payment service provider under a written agreement with
NEDA Labs:

| Parameter | Approved (consumer) | Requested (agent class) | Rationale |
| --- | --- | --- | --- |
| #2 — Participants | 100 | 100 consumers **+ 20 agents** | A cohort large enough to be statistically meaningful and small enough to supervise |
| #3 — Per transaction | 1,000,000 TZS | Unchanged | No single transaction needs to be larger |
| #4 — Per agent, per day | 2,000,000 TZS | 10,000,000 TZS | Approximately 200 transactions at observed average size |
| #5 — Per agent, 30 days | 60,000,000 TZS | 200,000,000 TZS | Consistent with the daily figure over a working month |

Maximum additional value at risk across the agent cohort: **200,000,000 TZS per
day**, fully backed by the reserve on the same terms as all other nTZS in issue.

## 7. Controls applying to the agent class

1. **Identity.** Every agent is verified against NIDA before a float is issued.
   The operating partner is subject to business verification (KYB) reviewed
   under maker–checker control before the capability is enabled for them.
2. **Reserve.** Agent floats are nTZS and are backed one-for-one by the same
   reserve, reported in the same daily attestation. The variation changes the
   volume of activity, not the backing.
3. **Per-float accounting.** Each float's daily and monthly usage is counted
   and enforced independently, as described in Section 5.
4. **Reporting.** We will report agent-cohort activity separately in the
   periodic return: floats issued, volume and value by destination type
   (wallet, till, biller), and exceptions.
5. **Suspension.** The capability is governed by a single control flag and a
   per-partner permission. Either can be withdrawn immediately, and doing so
   halts all agent activity without affecting other participants.

## 8. What the pilot would evidence

The Bank has an interest in whether digital settlement widens the services
available at the agent counter, which is where most Tanzanians meet the
financial system. A supervised cohort would produce direct evidence on:

- whether agents take up bill payment, government payments and bank transfers
  when the capital constraint is removed
- the effect on agent income, measured against the baseline in Section 2
- transaction success rates and settlement times by destination type
- whether customers are served for a wider set of needs at the same counter

We would share this data with the Bank in full, including results that do not
support the proposition.

## 9. Requested next step

A meeting to discuss the proposed parameters and reporting format, at the
Bank's convenience. We will not enable the capability for any agent until the
Bank has confirmed the parameters under which the pilot may operate.

---

**Contact**
NEDA Labs Limited
Victor A. Muhagachi, Chief Technology Officer
victor@nedapay.xyz
