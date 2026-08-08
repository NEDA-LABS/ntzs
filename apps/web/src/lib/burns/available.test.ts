import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import { insufficientBalanceMessage } from './available'

/**
 * A burn is paid out of ONE wallet. Presenting the sum of a participant's
 * wallets as "available" would put a figure on screen that the server refuses —
 * the same class of defect as showing nothing at all, only more insulting,
 * because the participant would have been told they could.
 */
describe('what is available is the largest single wallet, never the sum', () => {
  const SRC = fs.readFileSync(path.join(__dirname, 'available.ts'), 'utf8')

  it('offers the best single wallet as the withdrawable figure', () => {
    expect(SRC).toContain('maxTzs: best.tzs')
    expect(SRC).toMatch(/balances\.reduce\(\(a, b\) => \(b\.tzs > a\.tzs \? b : a\)\)/)
  })

  it('keeps the total as a separate figure, and flags when they differ', () => {
    expect(SRC).toContain('splitAcrossWallets: totalTzs > best.tzs')
  })

  it('reads every wallet, so a pre-migration balance is still found', () => {
    // Tokens minted to a CDP address before the HD migration sit on a wallet
    // that is not the default selection; reading only the default would refuse
    // a withdrawal the participant can genuinely fund.
    expect(SRC).toContain('walletList.map')
  })

  it('treats a wallet holding nothing as unfunded rather than usable', () => {
    expect(SRC).toContain('fundedWallet: best.tzs > 0 ? best.wallet : null')
  })

  it('drops fractional dust rather than offering a shilling that cannot be burned', () => {
    expect(SRC).toContain('BigInt(10) ** BigInt(18)')
  })
})

/**
 * The refusal and the figure on the screen come from one module so they cannot
 * describe different worlds — and the split case has to be explained, or it
 * reads as the platform having lost money the participant knows they hold.
 */
describe('the refusal explains itself', () => {
  it('states what is available and what was needed', () => {
    const msg = insufficientBalanceMessage(
      { maxTzs: 400_000, totalTzs: 400_000, splitAcrossWallets: false },
      1_509_046,
      1_500_000
    )
    expect(msg).toContain('400,000 nTZS available')
    expect(msg).toContain('1,509,046 nTZS')
    expect(msg).toContain('1,500,000 TZS')
  })

  it('says nothing about wallets when there is only one holding', () => {
    const msg = insufficientBalanceMessage(
      { maxTzs: 400_000, totalTzs: 400_000, splitAcrossWallets: false },
      500_000,
      495_000
    )
    expect(msg).not.toContain('spread across')
  })

  it('explains a split holding instead of looking like lost money', () => {
    const msg = insufficientBalanceMessage(
      { maxTzs: 600_000, totalTzs: 1_200_000, splitAcrossWallets: true },
      1_000_000,
      990_000
    )
    expect(msg).toContain('1,200,000 nTZS in total')
    expect(msg).toContain('single wallet')
    expect(msg).toContain('consolidate')
  })
})

/**
 * The screen used to show no balance at all: a participant typed an amount
 * cold. Three then requested off-ramps of balances they never held.
 */
describe('the withdrawal screen shows what the participant holds', () => {
  const FORM = fs.readFileSync(
    path.join(__dirname, '../../app/app/user/withdraw/WithdrawForm.tsx'),
    'utf8'
  )
  const PAGE = fs.readFileSync(
    path.join(__dirname, '../../app/app/user/withdraw/page.tsx'),
    'utf8'
  )

  it('prints an available figure above the amount field', () => {
    expect(FORM).toContain('Available to withdraw')
    expect(FORM).toContain('availableTzs.toLocaleString()')
    expect(FORM.indexOf('Available to withdraw')).toBeLessThan(FORM.indexOf('name="amountTzs"'))
  })

  it('reads it with the same function the action refuses with', () => {
    expect(PAGE).toContain('readAvailability(')
  })

  it('shows zero rather than a balance it could not confirm', () => {
    // A failed chain read must not become an encouraging number; the action
    // reads again for itself and refuses on its own result either way.
    expect(PAGE).toContain('availability?.maxTzs ?? 0')
  })
})
