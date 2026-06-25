import { NextRequest, NextResponse } from 'next/server';

import { getSessionFromCookies } from '@/lib/fx/auth';
import { withIdempotency, getIdempotencyKey } from '@/lib/idempotency';
import { needsApproval, createApproval } from '@/lib/fx/approvals';
import { executeWithdraw, validateWithdrawParams, type WithdrawParams } from '@/lib/fx/withdraw';
import type { ChainId } from '@/lib/fx/chainConfig';

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { token?: string; toAddress?: string; amount?: string; chain?: ChainId };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
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

  // Maker-checker: an operator's withdrawal is queued for an approver instead of
  // moving funds. Owners and approvers withdraw directly.
  if (needsApproval(session.role)) {
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
