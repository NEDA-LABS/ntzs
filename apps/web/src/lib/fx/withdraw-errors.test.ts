import { describe, it, expect } from 'vitest';

import { isPreBroadcast } from './withdraw';

describe('isPreBroadcast', () => {
  it('recognises failures that happen before anything is sent', () => {
    // These all come from estimateGas or argument checks, so the transfer
    // never reached the mempool and a corrected retry is safe.
    for (const code of ['CALL_EXCEPTION', 'INSUFFICIENT_FUNDS', 'UNPREDICTABLE_GAS_LIMIT', 'NONCE_EXPIRED', 'INVALID_ARGUMENT']) {
      expect(isPreBroadcast({ code })).toBe(true);
    }
  });

  it('treats a timeout as ambiguous, because it is', () => {
    // The case that actually happened: the RPC stopped answering. Nothing here
    // says whether the transfer was broadcast, so it must not be reported as a
    // clean failure — a retry could pay the same address twice.
    expect(isPreBroadcast({ code: 'TIMEOUT' })).toBe(false);
    expect(isPreBroadcast({ code: 'NETWORK_ERROR' })).toBe(false);
    expect(isPreBroadcast({ code: 'SERVER_ERROR' })).toBe(false);
  });

  it('defaults to ambiguous for an error it does not recognise', () => {
    expect(isPreBroadcast(new Error('something else'))).toBe(false);
    expect(isPreBroadcast(undefined)).toBe(false);
  });
});
