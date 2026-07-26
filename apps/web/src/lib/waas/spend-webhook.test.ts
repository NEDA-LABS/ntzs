import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/waas/partner-webhooks', () => ({ queuePartnerWebhook: vi.fn() }))

import { queuePartnerWebhook } from '@/lib/waas/partner-webhooks'
import { emitSpendWebhook } from './spend-webhook'

const queued = vi.mocked(queuePartnerWebhook)

beforeEach(() => queued.mockReset())

describe('emitSpendWebhook', () => {
  const spend = {
    partnerId: 'partner-1',
    externalId: 'ext-9',
    kind: 'lipa',
    recipientName: 'ENZI COFFEE COMPANY LIMITED',
    principalTzs: 1000,
    actualChargesTzs: 30,
    selcomReceipt: 'SB0725LE5SC',
  }

  it('queues a signed spend.updated with the disclosure snapshot', async () => {
    await emitSpendWebhook(spend, { burnRequestId: 'b-1', reference: '202607259999', status: 'completed', burnAmountTzs: 1035 })
    expect(queued).toHaveBeenCalledTimes(1)
    const [partnerId, event, data] = queued.mock.calls[0]
    expect(partnerId).toBe('partner-1')
    expect(event).toBe('spend.updated')
    expect(data).toMatchObject({
      spendId: 'b-1',
      externalId: 'ext-9',
      reference: '202607259999',
      status: 'completed',
      kind: 'lipa',
      recipientName: 'ENZI COFFEE COMPANY LIMITED',
      selcomReceipt: 'SB0725LE5SC',
    })
  })

  it('does NOT queue for a non-partner (direct-app) spend', async () => {
    await emitSpendWebhook({ kind: 'lipa' }, { burnRequestId: 'b-2', reference: 'r', status: 'reverted', burnAmountTzs: 500 })
    expect(queued).not.toHaveBeenCalled()
  })

  it('never throws when the queue fails (settlement must not be affected)', async () => {
    queued.mockRejectedValueOnce(new Error('db down'))
    await expect(
      emitSpendWebhook(spend, { burnRequestId: 'b-3', reference: 'r', status: 'completed', burnAmountTzs: 1035 })
    ).resolves.toBeUndefined()
  })
})
