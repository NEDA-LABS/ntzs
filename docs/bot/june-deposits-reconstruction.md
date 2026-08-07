# June deposits — reconstruction worksheet

**Owner:** NEDA Labs Limited · nTZS
**Purpose:** close the "twelve June deposits" gap in the incident register before the
31 August milestone return
**Status:** open — awaiting the database reads below
**Last updated:** 7 August 2026

---

## 1. What is being reconstructed, and why now

The incident register (`docs/bot/incident-management.md` §6) was backfilled on 28 July
2026 and records one known exclusion: *a set of twelve June deposits which were paid by
customers but not credited*, held out until the underlying records are read. The
milestone return due 31 August reports incidents from the register, so the exclusion
must be resolved — either into register entries meeting the §4 standard, or into a
documented finding that a given row was not in fact a paid deposit.

Two things changed since the exclusion was written:

- **The reporting period now starts 23 June 2026** (`BOT_SANDBOX_COMMENCED_ON`, from the
  Bank's approval letter). June deposits therefore straddle the commencement line:
  rows **on or after 23 June** are in-period and belong in section 3 of the return
  proper; rows **before 23 June** are pre-commencement pilot activity — they still go
  in the register (it begins where the platform began), and the return discloses them
  as context, not as sandbox-period incidents.
- **A remediation path now exists.** Backstage → Minting → *PSP says paid* credits a
  deposit against a verified provider reference, refuses a reference already used on
  another deposit, and routes through the normal approval gate. Any June payment a
  provider's records confirm can be made whole through it — no SQL, no direct mint.

## 2. Method

The count of twelve is treated as a claim to re-derive, not a fact to decorate. The
reads below pull every June deposit that did not credit normally, with the evidence
needed to classify each row. They are **read-only** and are run manually against the
production database (our standing practice — no application credentials involved).

The known retry storm (one user, hundreds of identical small rows minutes apart on
24 June) is separated mechanically — rows in a (user, amount) group larger than ten are
aggregated in read B rather than listed in read A — so the storm cannot bury the real
candidates, and nothing is silently dropped.

Timestamps are UTC (as stored). If the classified set does not reconcile to the twelve
the register expected, re-run read A with the June window shifted to EAT bounds
(`2026-05-31T21:00Z` → `2026-06-30T21:00Z`) before concluding the register was wrong.

### Read A — candidate rows (storm groups excluded)

Every June deposit that either never credited or credited more than 24 hours late,
with our own evidence of payment alongside.

### Read B — high-volume groups

The (user, amount) groups excluded from A, aggregated: row counts, time span, how many
rows carry a provider reference, whether any row minted. Expected to contain the
24 June retry storm; anything else here is new information.

### Read C — manual reconciliation entries

All `reconciliation_entries`, as context: whether any June payment was already made
whole outside the deposit flow (an untracked or manual mint would appear here, not in
`mint_transactions`).

The SQL for A–C is delivered with the run instructions rather than duplicated here;
the column set is: creation time, customer, amount, provider and channel, provider
reference, status, payment evidence, outcome (never credited / credited N days late /
mint state), any recorded approval decisions, and the deposit id.

## 3. Classification rules

Each row from read A lands in exactly one class:

| Class | Test | Register treatment |
|---|---|---|
| **Paid, never credited** | Provider reference on file (or provider records confirm payment) and no mint | Entry with `funds_lost_tzs` = amount until remediated; remediate via *PSP says paid*, then record the credit date |
| **Possibly paid, unverifiable on our side** | No reference, no confirmation, but the customer plausibly paid (the silent-close bug class) | Entry with `funds_lost_tzs` NULL — unestablished, never zero — and the provider-side check named as the outstanding step |
| **Credited late** | Minted eventually, > 24 h after creation | Covered by one entry describing the delay cohort; `funds_lost_tzs` 0 for these rows |
| **Never paid** | Provider records show no payment; row is an abandoned or failed attempt | Not an incident — documented in the worksheet outcome and excluded, with the provider check as evidence |
| **Retry storm** | Read B group | One entry for the storm itself (defect class: unguarded client retries creating unbounded rows); see the control note below |

**Control dependency, stated plainly:** the register refuses an entry without a control
added, and the storm's honest control is a **deposit-creation rate limit**, which is
designed but not yet shipped. Filing the storm entry therefore requires either shipping
the rate limit first or recording the control as planned-with-date — the register
standard prefers the former, and this is the forcing function to build it.

## 4. What happens with the results

1. Each classified row is written up as register entries (`INC-2026-06-…`) meeting the
   §4 standard — what happened, customer impact, explicit funds figure or an honest
   NULL, root cause, control added, evidence reference — applied as an idempotent seed
   migration in `drizzle/` (`ON CONFLICT (ref) DO NOTHING`), the same way every
   existing entry was applied.
2. Any row in the first class is remediated through *PSP says paid* before filing where
   the provider reference can still be verified, and the entry records the credit.
3. Section 3 of the milestone return then reports the June entries with the
   pre/post-commencement split from §1 of this worksheet, and the register's §6
   exclusion paragraph is updated to say the reconstruction is complete.

## 5. Privacy

Customer identities appear in the database reads and in the register (which already
holds customer data under the platform's controls). They do not appear in this
worksheet, in commit messages, or in any repository file — entries describe *a
customer* or *two wallet holders*, never names or addresses.
