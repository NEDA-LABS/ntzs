# Periodic return to the Bank of Tanzania — architecture

**Owner:** NEDA Labs Limited · nTZS
**First application:** milestone report due 31 August 2026
**Last updated:** 7 August 2026

---

## 1. What this document is

The shape of every periodic return we file, and where each number in it comes from.
It exists so that the report is *generated* rather than *assembled* — the same
definitions, in the same order, every period, each figure traceable to a query
anyone can re-run.

That is not administrative tidiness. A supervisor comparing this period's return to
the last one is really asking whether the operator has a system or a scramble. A
number that moves because the definition moved is worse than a number that moves.

## 2. Three rules the return obeys

**Every figure carries its provenance.** Each number is printed with the
derivation that produced it. Whoever signs the return can re-derive it; whoever
inspects us later can too; and the next return uses the same definition because
the definition travels with the number instead of living in someone's head.

**A figure that cannot be computed is never zero.** If a query fails or a table is
absent, the figure reads *unavailable*, with the reason. Zero is a claim about the
world; a failed query is a claim about our plumbing. A document the Bank relies on
must never confuse the two. The generator refuses to substitute one for the other,
and lists every such gap at the top of the page as a pre-filing warning.

**Shortcomings are reported, not discovered.** The incident register (see
`incident-management.md`) is the internal record; the return is a disclosed subset
of it, and the register tracks which entries were disclosed and where. It is
therefore not possible for the return to quietly contain a shorter list than the
one we keep for ourselves.

## 3. The sections

| # | Section | The supervisory question | Source |
|---|---|---|---|
| 1 | Executive summary | What was tested, what was learned, what is being asked for? | Written last, from the rest |
| 2 | Compliance with the approved testing parameters | Are the limits actually binding, and can you show one binding? | Computed |
| 3 | Incidents, shortcomings and errors | What went wrong, who was affected, what changed? | Computed from the register |
| 4 | Operational statistics | How much moved, through what, for how many, and how often did it work? | Computed |
| 5 | Reserve management and the peg | Was every shilling backed, every day, and can you show it? | Computed from the attestation series |
| 6 | Onboarding and consumer protection | Who is allowed in, what are they shown before money moves? | Computed + narrative |
| 7 | What the pilot established about the market | Does this solve a real problem, with evidence? | Narrative, from measured transactions |
| 8 | Variations sought | What do you want, and what have you done to earn it? | Narrative |

Generated at `/backstage/bot-report`. Sections 2–6 come from
`apps/web/src/lib/bot-report/figures.ts`; sections 1, 7 and 8 are deliberately
narrative and appear as headed placeholders so they cannot be forgotten.

### Section 2 — the one that is read first

Reports, per parameter: the approved limit, the largest value actually observed
against it, and the number of attempts it refused.

The third of those is the point. "We set a limit" is a design claim; "here are the
transactions it refused, with dates and participants" is evidence. It exists only
because every enforcement point records its blocks (`sandbox_limit_events`,
`drizzle/0069`), and it is worth stating in the return that recording began at that
point — an empty list means *no participant reached a limit*, not *nothing was ever
checked*.

The daily figure is computed with the same arithmetic the live enforcement uses —
deposits and burns summed per participant per day — so the reported maximum and the
enforced cap cannot drift apart.

### Section 5 — read, not recomputed

The reserve figures come from the attestation rows already submitted daily, not
from a fresh calculation. If the return recomputed the peg it could disagree with
the daily submissions the Bank already holds, and no explanation of that
discrepancy would be worth hearing.

The section also names the calendar rather than only counting it: the EAT days
with **no attestation row** (days the platform refused to attest rather than send
a degraded reading), and the days attested on a **qualified basis** — a reserve
pot evidenced by the custodian's statement or by our last verified reading
carried forward instead of a live read. Both are listed by date with a
pre-filing warning, because the Bank can see the holes in a daily series it
already holds; the return must name them first and explain each one.

## 4. What can and cannot be reconstructed

Most of the return is reconstructible from data already held: every deposit, burn,
verification case and attestation carries its own timestamp, so volumes,
participant counts, success rates and the peg series can all be derived for any
past period. This is worth stating plainly rather than treating every metric as
urgent.

What is **not** reconstructible, and therefore had to exist before the fact:

| Not reconstructible | Captured since |
|---|---|
| Transactions refused by a testing parameter | `sandbox_limit_events`, 28 Jul 2026 |
| Incidents, root causes and controls added | `incidents`, 28 Jul 2026 |
| Reserve position on a past day | `attestations`, daily since commencement |
| Rail availability over time | `psp.health` audit entries, every 5 minutes |

Both of the first two began on 28 July 2026. The return should say so rather than
present a partial series as a complete one.

## 5. Known gaps to close before filing

Closed gaps move down the list rather than disappearing — the closure is part of
the record of how the return came to look the way it does.

Still open:

- **Incidents predating the register.** The twelve June deposits that were paid but
  not credited are known and excluded until the underlying records are read. They
  belong in section 3 of this return.
- **Reserve custody.** The Bank's approval letter requires a single ring-fenced
  trust account at a regulated commercial bank. The reserve is currently spread
  across payment service provider float accounts. This needs a resolution and a
  paragraph, not silence.

Closed in the generator (7 August 2026):

- **The period start is stated, not inferred.** The default period is anchored to
  `BOT_SANDBOX_COMMENCED_ON` (the commencement date from the Bank's letter,
  documented in `.env.example`), and the page labels where its default came from.
  Until the variable is set it falls back to the earliest attestation on record —
  a fact, but not the anchor. The remaining step is operational: set the variable
  from the letter, once, before the first return.
- **How incidents are found.** Section 3 now computes the distribution of
  `detected_by` across the period and raises a pre-filing warning when nothing in
  the period was found by automated monitoring. The weakness itself is still real
  — the closure is that the return now states it, with the work planned against
  it, instead of leaving it to be noticed.
- **The attestation calendar, day by day.** Section 5 now lists days with no
  attestation row and days attested on substituted evidence, each by date with a
  pre-filing warning — see §3 above.

## 6. Filing discipline

1. Generate the return for the period at `/backstage/bot-report`.
2. Clear every **pre-filing warning** at the top of the page. Each one is either a
   number that could not be computed or a figure that breached an approved
   parameter. Neither may be filed as-is.
3. Write sections 1, 7 and 8.
4. Copy each disclosed incident verbatim from the register, then mark it disclosed
   there, naming this return.
5. File. The register now shows what the Bank has been told, and the next return
   starts from the same definitions.
