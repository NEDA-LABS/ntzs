import { NextRequest, NextResponse } from 'next/server';

import { getSessionFromCookies } from '@/lib/fx/auth';
import { withIdempotency, getIdempotencyKey } from '@/lib/idempotency';
import { actionDisposition, createApproval } from '@/lib/fx/approvals';
import { executeWithdraw, validateWithdrawParams, type WithdrawParams } from '@/lib/fx/withdraw';
import { executeBankCashout, validateBankCashout, type BankCashoutParams } from '@/lib/fx/bank-cashout';
import type { ChainId } from '@/lib/fx/chainConfig';

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    method?: 'crypto' | 'bank';
    token?: string;
    toAddress?: string;
    amount?: string;
    chain?: ChainId;
    amountTzs?: number;
    bankCode?: string;
    accountNumber?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // ── Bank cash-out: redeem nTZS for TZS into the LP's bank account ─────────
  // Supply must fall by what leaves the reserve, so this burns rather than
  // transfers. Same maker-checker gate as the on-chain path.
  if (body.method === 'bank') {
    const cashoutDraft: Partial<BankCashoutParams> = {
      amountTzs: Number(body.amountTzs),
      bankCode: body.bankCode,
      accountNumber: body.accountNumber,
    };
    const cashoutError = validateBankCashout(cashoutDraft);
    if (cashoutError) return NextResponse.json({ error: cashoutError }, { status: 400 });
    const cashoutParams = cashoutDraft as BankCashoutParams;

    const cashoutDisposition = actionDisposition(session.role);
    if (cashoutDisposition === 'deny') {
      return NextResponse.json({ error: 'Your role does not permit withdrawals.' }, { status: 403 });
    }
    if (cashoutDisposition === 'queue') {
      await createApproval({
        lpId: session.lpId,
        action: 'withdraw',
        payload: { ...cashoutParams, method: 'bank' },
        memberId: session.memberId,
      });
      return NextResponse.json({ ok: true, pending: true, message: 'Cash-out submitted to an approver.' });
    }

    return withIdempotency(`lp_cashout:${session.lpId}`, getIdempotencyKey(req), async () => {
      const r = await executeBankCashout(session.lpId, cashoutParams);
      if (!r.ok) {
        return NextResponse.json(
          { error: r.error, burnRequestId: r.burnRequestId, burnTxHash: r.burnTxHash },
          { status: r.status ?? 400 },
        );
      }
      return NextResponse.json({
        ok: true,
        status: 'dispatched',
        burnTxHash: r.burnTxHash,
        payoutReference: r.payoutReference,
        receiveAmountTzs: r.receiveAmountTzs,
        feeTzs: r.feeTzs,
        burnedTzs: r.burnedTzs,
        recipientName: r.recipientName,
      });
    });
  }

  const draft: Partial<WithdrawParams> = {
    token: body.token,
    toAddress: body.toAddress,
    amount: body.amount,
    chain: body.chain ?? 'base',
  };
  const validationError = validateWithdrawParams(draft);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const params = draft as WithdrawParams;

  // Maker-checker + least-privilege: owner/approver withdraw directly, an operator's
  // withdrawal is queued for an approver, and any other role (viewer) is denied.
  const disposition = actionDisposition(session.role);
  if (disposition === 'deny') {
    return NextResponse.json({ error: 'Your role does not permit withdrawals.' }, { status: 403 });
  }
  if (disposition === 'queue') {
    await createApproval({ lpId: session.lpId, action: 'withdraw', payload: params, memberId: session.memberId });
    return NextResponse.json({ ok: true, pending: true, message: 'Withdrawal submitted to an approver.' });
  }

  // Dedup the on-chain transfer so a client retry can't double-withdraw.
  return withIdempotency(`lp_withdraw:${session.lpId}`, getIdempotencyKey(req), async () => {
    const r = await executeWithdraw(session.lpId, params);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
    return NextResponse.json({ txHash: r.txHash, status: 'confirmed', chain: params.chain });
  });
}
