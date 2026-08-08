import { describe, it, expect } from 'vitest'

import { burnAgeing, isHeld, orderBurnQueue, summariseBurnQueue } from './ageing'

const NOW = new Date('2026-08-08T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)
const daysAgo = (d: number) => hoursAgo(d * 24)

/**
 * The failure this exists to prevent: three withdrawals waited six weeks in
 * `requires_second_approval` and nobody saw them, because the queue was sorted
 * newest-first and they had fallen off the bottom of the page.
 */
describe('a request waiting on us is never lost at the bottom of the queue', () => {
  it('puts held requests first, oldest at the top', () => {
    const ordered = orderBurnQueue([
      { id: 'settled-new', status: 'burned', createdAt: hoursAgo(1) },
      { id: 'held-new', status: 'requested', createdAt: hoursAgo(2) },
      { id: 'held-ancient', status: 'requires_second_approval', createdAt: daysAgo(44) },
      { id: 'settled-old', status: 'failed', createdAt: daysAgo(50) },
    ])
    expect(ordered.map((r) => r.id)).toEqual(['held-ancient', 'held-new', 'settled-new', 'settled-old'])
  })

  it('treats every non-terminal status as waiting on us', () => {
    for (const status of ['requested', 'requires_second_approval', 'approved', 'burn_submitted']) {
      expect(isHeld(status), status).toBe(true)
    }
    // Terminal: nothing is owed, and the customer is not waiting.
    for (const status of ['burned', 'rejected', 'failed']) {
      expect(isHeld(status), status).toBe(false)
    }
  })
})

describe('escalation bands', () => {
  it('leaves a request inside a working day alone', () => {
    const a = burnAgeing(hoursAgo(4), NOW)
    expect(a.tier).toBe('fresh')
    expect(a.needsAttention).toBe(false)
    expect(a.label).toBe('4h')
  })

  it('marks a day-old request as ageing, but does not yet interrupt anyone', () => {
    const a = burnAgeing(hoursAgo(25), NOW)
    expect(a.tier).toBe('ageing')
    expect(a.needsAttention).toBe(false)
  })

  it('raises a three-day-old request — the customer has asked twice by now', () => {
    const a = burnAgeing(daysAgo(3), NOW)
    expect(a.tier).toBe('stale')
    expect(a.needsAttention).toBe(true)
  })

  it('calls a week a service failure, whatever the reason for the hold', () => {
    const a = burnAgeing(daysAgo(8), NOW)
    expect(a.tier).toBe('overdue')
    expect(a.needsAttention).toBe(true)
    expect(a.label).toBe('8d')
  })

  it('ages the real June requests as overdue', () => {
    // The three that went unseen: 25, 26 and 28 June, read on 8 August.
    for (const day of ['2026-06-25T23:47:00+03:00', '2026-06-26T08:43:00+03:00', '2026-06-28T06:48:00+03:00']) {
      const a = burnAgeing(day, NOW)
      expect(a.tier, day).toBe('overdue')
      expect(a.hours, day).toBeGreaterThan(24 * 40)
    }
  })

  it('never reports a negative age for a clock that ran backwards', () => {
    expect(burnAgeing(new Date(NOW.getTime() + 60_000), NOW).hours).toBe(0)
  })
})

describe('the queue summary', () => {
  const rows = [
    { status: 'requires_second_approval', createdAt: daysAgo(44), amountTzs: 1_509_046 },
    { status: 'requires_second_approval', createdAt: daysAgo(41), amountTzs: 1_107_036 },
    { status: 'requested', createdAt: hoursAgo(2), amountTzs: 20_000 },
    { status: 'burned', createdAt: daysAgo(1), amountTzs: 900_000 },
  ]

  it('counts what is waiting and what is overdue separately', () => {
    const s = summariseBurnQueue(rows, NOW)
    expect(s.held).toBe(3)
    // The two-hour-old one is waiting but is not a problem yet.
    expect(s.needsAttention).toBe(2)
  })

  it('reports the age of the longest wait, not the average', () => {
    // An average would let one ancient request hide behind a dozen fresh ones.
    expect(summariseBurnQueue(rows, NOW).oldest?.tier).toBe('overdue')
    expect(summariseBurnQueue(rows, NOW).oldest?.label).toBe('44d')
  })

  it('totals only what participants are still owed', () => {
    // The completed burn is not owed to anyone.
    expect(summariseBurnQueue(rows, NOW).heldTzs).toBe(1_509_046 + 1_107_036 + 20_000)
  })

  it('says nothing is waiting when nothing is', () => {
    const s = summariseBurnQueue([{ status: 'burned', createdAt: daysAgo(1), amountTzs: 5 }], NOW)
    expect(s).toMatchObject({ held: 0, needsAttention: 0, oldest: null, heldTzs: 0 })
  })

  it('does not reorder the caller’s array while summarising it', () => {
    const input = [...rows]
    summariseBurnQueue(input, NOW)
    expect(input).toEqual(rows)
  })
})
