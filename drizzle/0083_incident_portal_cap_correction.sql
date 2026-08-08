-- 0083: correction to INC-2026-06-001, and a second defect found while
-- establishing the facts behind it.
--
-- 0082 recorded the three June withdrawal requests above the approved
-- per-transaction limit as customers whose withdrawals had been delayed, and
-- put TZS 3,622,615 in funds_at_risk on the reasoning that this was the value
-- that would have moved had the second control not held it.
--
-- BOTH WERE WRONG, and in the same direction: they assumed the requests were
-- fundable. They were not. The three participants were attempting to off-ramp
-- balances they did not hold. No wallet behind any of the three carried the
-- nTZS the request would have burned, so no value could have moved even if
-- every approval had been given — the burn would have reverted on-chain.
-- funds_at_risk is therefore 0, not 3,622,615, and the customers were not
-- waiting on money owed to them.
--
-- The register is never rewritten to look better, and this correction does not
-- reduce the severity: it moves the harm from "customers delayed" to "the
-- platform accepted, queued and reported requests that could never execute".
-- The second reading is worse for us, not better. The entry stays sev2.
--
-- THE SECOND DEFECT, which is why this is a correction and not a footnote. The
-- withdrawal path checked the participant's on-chain balance INSIDE the branch
-- that executes small withdrawals immediately, past the early return that
-- queues large ones. A withdrawal big enough to require a second authorisation
-- was therefore written into the approval queue without anyone asking whether
-- the balance existed. That is how three unfundable requests entered a money
-- queue, sat there for six weeks, and reached a regulatory return as
-- transactions above an approved limit. The balance check now runs before the
-- approval branch and before any burn row is written, and a structural test
-- pins that ordering — the checks were all individually correct and the bug was
-- which side of a branch one of them sat on, which no unit test of the checks
-- themselves would have caught.
--
-- The three requests remain in 'requires_second_approval'. They must be
-- rejected with a reason rather than approved; a request to move value nobody
-- holds cannot be authorised, and leaving them in the queue misrepresents them
-- as a debt to a customer. That is an operator action, recorded separately.

UPDATE "incidents" SET
  "title" = 'Approved per-transaction limit not enforced on the user portal, and unfundable withdrawals accepted into the approval queue',
  "customer_impact" = 'Three participants submitted withdrawal requests above the approved per-transaction limit during the period: TZS 1,509,046 on 25 June 2026, TZS 1,006,533 on 26 June 2026 and TZS 1,107,036 on 28 June 2026. None of them executed and none of them could have. The participants were attempting to redeem balances they did not hold: no wallet behind any of the three carried the nTZS the request would have burned, so the burn would have reverted on-chain had any approval been given. No customer lost funds, none was charged, and no customer was owed money that we failed to pay. The harm is not to these three participants but to the integrity of our own controls and reporting: the platform accepted requests it could never have honoured, held them in a queue intended for genuine authorisations, and carried their amounts into a regulatory return as though they were transactions that had occurred.',
  "funds_at_risk_tzs" = 0,
  "root_cause" = 'Two defects with the same shape: a check placed inside the branch that was being reviewed rather than ahead of every branch that needs it. First, the approved per-transaction limit was applied at the four money paths that are API routes and not at the three that are server actions, and the test intended to guarantee coverage enumerated API routes only — the same scope as the implementation, so nothing raised its hand. Second, the on-chain balance check sat inside the path that executes small withdrawals immediately, past the early return that queues large ones, so a withdrawal above the approval threshold was written into the queue without any test of whether the participant held the balance. Neither check was wrong in itself. Both were in the wrong place, and in both cases the thing that was supposed to notice shared the blind spot.',
  "resolution" = 'The three participant-facing money paths now call the single cap-enforcement chokepoint before any row is written, counted against the participant who ends up holding the tokens. The on-chain balance check now runs before the approval branch and before any burn row is created, so an unfundable request is refused at the door with the balance stated rather than queued for a human to consider. The three June requests remain held and are to be rejected with a reason, not approved.',
  "control_added" = 'Two structural tests, both asserting against the real source because both defects were ordering rather than logic. The first walks every source file that inserts into deposit_requests or burn_requests — not the API route directory alone — and requires each to either call the enforcement chokepoint or appear in an explicit platform-float list with a stated reason that no participant holds the balance; a stale entry in that list fails too. The second pins the withdrawal ordering: the balance check must precede both the approval branch and any burn insert, and must refuse rather than queue when no wallet holds the amount. Separately, the backstage burns queue now orders held requests oldest-first with an age badge and raises a banner past three days, so a request cannot sit unseen for six weeks again.',
  "evidence_ref" = 'PR #259, PR #260, PR #261, PR #262',
  "updated_at" = now()
WHERE "ref" = 'INC-2026-06-001';
