import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

/**
 * Structural guards on the withdrawal path.
 *
 * These assert against the real source rather than a fixture, because the
 * defect they pin was an ORDERING one — every individual check existed and was
 * correct, and the bug was which side of a branch one of them sat on. A unit
 * test of the checks themselves would have passed throughout.
 */
const SRC = fs.readFileSync(
  path.join(__dirname, '../../app/app/user/withdraw/actions.ts'),
  'utf8'
)

/**
 * A withdrawal large enough to need a second authorisation used to be queued
 * without anyone asking whether the participant held the balance: the balance
 * check sat inside the execute-inline path, past the early return. Three
 * requests to move money that was never there sat in the approval queue for six
 * weeks, and then surfaced in a regulatory return as transactions above an
 * approved limit.
 *
 * A request to move value nobody holds is not a withdrawal to approve. It is
 * one to refuse at the door.
 */
describe('no withdrawal is queued for approval without a balance behind it', () => {
  const balanceAt = SRC.indexOf('Pre-flight on-chain balance check')
  const queueAt = SRC.indexOf('Large amounts require admin approval')
  const insertAt = SRC.indexOf('insert(burnRequests)')

  it('checks the balance before the approval branch', () => {
    expect(balanceAt, 'the balance check has gone missing').toBeGreaterThan(-1)
    expect(queueAt, 'the approval branch has gone missing').toBeGreaterThan(-1)
    expect(
      balanceAt,
      'the balance check must run BEFORE the approval branch, or a request for money the ' +
        'participant does not hold is queued for a human to consider'
    ).toBeLessThan(queueAt)
  })

  it('checks the balance before any burn row is written at all', () => {
    expect(insertAt).toBeGreaterThan(-1)
    expect(balanceAt).toBeLessThan(insertAt)
  })

  it('refuses rather than queueing when no wallet holds the amount', () => {
    const block = SRC.slice(balanceAt, queueAt)
    expect(block).toContain('Insufficient balance')
    expect(block).toContain('return {')
  })

  it('still enforces the approved caps before writing anything', () => {
    // The other ordering that matters: the cap must bind before the row exists,
    // so a refusal leaves a limit event and no request.
    const capAt = SRC.indexOf('enforceSandboxLimits(')
    expect(capAt).toBeGreaterThan(-1)
    expect(capAt).toBeLessThan(insertAt)
  })

  it('searches every wallet the participant holds, not just the default one', () => {
    // Tokens minted to a CDP address before the HD migration live on a wallet
    // that is not the default selection; checking only the default would refuse
    // a withdrawal the participant can actually fund.
    const block = SRC.slice(balanceAt, queueAt)
    expect(block).toContain('for (const w of allWallets)')
    expect(block).toContain('wallet = fundedWallet')
  })
})
