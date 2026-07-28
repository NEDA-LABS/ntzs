# Incident management

**Owner:** NEDA Labs Limited · nTZS
**Applies to:** the nTZS platform operating under the Bank of Tanzania Regulatory Sandbox
**Last updated:** 28 July 2026

---

## 1. Why this exists

After anything goes wrong, a supervisor asks three questions: what happened, who was
affected, and what has changed so it does not happen again. Those questions are
answerable from memory for about a week. After that, an honest operator and a careless
one produce the same shrug.

So the answers are written down as they happen, in one place, in prose, by the person
who dealt with it. That record is the **incident register**. It is maintained inside the
platform's administrative console and is available for inspection.

## 2. What goes in it

The register is curated, not automatic. The platform separately records every event on
every money path — deposits, mints, burns, payouts, webhook deliveries, administrative
actions — and that stream is complete and immutable. The register is the much smaller
set of events a person judged worth writing down.

An entry is created when either of the following was **live in production**:

- a defect on a customer-facing or money-moving path, whether or not it is known to have
  fired; or
- a control that was believed to be in place and was not.

Defects identified and corrected before release are ordinary development and are **not**
recorded. Padding the register with near-misses would make it flattering rather than
useful, and would dilute the entries that matter.

## 3. Severity

| | Meaning |
|---|---|
| **Sev 1** | Customer funds lost, or the service unavailable |
| **Sev 2** | A defect in money handling, authorisation or regulatory compliance reached production |
| **Sev 3** | A control or evidence gap, with no customer impact |
| **Sev 4** | Internal-only degradation (administrative tooling) |

Severity describes what actually happened, not how urgent it felt. The line between
Sev 2 and Sev 3 is whether a customer-facing or money-moving path behaved wrongly, or
only the evidence around it was thin.

## 4. What every entry must contain

- **What happened** — plain narrative, understandable without reading the code.
- **Customer impact** — "none" is a valid answer; blank is not.
- **Funds lost, in shillings** — an explicit figure, *including zero*. Where the answer
  is not yet established the field is left empty and reported as unestablished. It is
  never defaulted to zero. "No customer has lost funds" is the most consequential
  statement we make, and it is reported as the sum of a column rather than as an
  assurance.
- **Root cause** — why it was possible, not only what the defect was.
- **Control added** — what now makes recurrence structurally harder: an automated test,
  an authorisation gate, a single enforcement point. **The register will not accept an
  entry without one, and will not accept an incident being closed without one.** An
  incident with no control against it is an incident that will recur.
- **Evidence** — where an inspector can verify it: the change record, the commit, the
  log query.

## 5. Properties of the record

1. **Nothing is deletable.** Entries can be updated; every update is written to the
   audit log with the actor and the before-and-after values. There is no delete path in
   the application. A register that can be quietly emptied is worth nothing to the
   person reading it.
2. **How each incident was found is recorded** — automated monitoring, log review,
   a customer, a partner, internal review, or the regulator. This is tracked because the
   distribution is diagnostic in itself: a register where nothing is ever caught by
   monitoring is telling us something about the monitoring, and one where customers
   dominate is telling us the customers *are* the monitoring.
3. **Disclosure is a separate, deliberate act.** Recording an incident does not disclose
   it. Marking an entry as disclosed requires naming the return it appears in, and
   stamps a date and an actor. The register is complete internally; a periodic return is
   a subset of it with a signature against it.

## 6. Backfill and completeness

The register was established on 28 July 2026 and backfilled from change history,
production logs and review notes so that it begins where the platform began rather than
where the table was created. Entries carry the date of the exposure window where that is
known; where a latent defect cannot be dated honestly, the entry carries the date of
identification and says so in the narrative. A vague date is preferable to an invented
one.

The backfill is not asserted to be exhaustive. Known events that have not yet been
reconstructed to the standard in section 4 — principally a set of twelve June deposits
which were paid by customers but not credited — are excluded until the underlying
records have been read, and will be added with the same detail as the rest.

## 7. Reporting to the Bank

Material incidents (Sev 1 and Sev 2) are reported in the periodic return for the period
in which they occurred, with the same fields as the register entry. Any incident
involving customer loss, or any breach of an approved testing parameter, is reported
whether or not a periodic return falls due.
