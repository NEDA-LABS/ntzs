import { describe, it, expect } from 'vitest';

import { awaitingReview, lastSelfServeStep, isComplete, totalSteps } from './onboarding';

describe('lastSelfServeStep', () => {
  it('stops at the last step the bank itself can act on', () => {
    // 1 profile, 2 kyb, 3 banking, 4 fx, 5 team | 6 sandbox and 7 golive are ours
    expect(lastSelfServeStep('bank')).toBe(5);
  });

  it('counts every standard step as self-serve', () => {
    expect(lastSelfServeStep('standard')).toBe(totalSteps('standard'));
  });
});

describe('awaitingReview', () => {
  it('is false while the bank still has a step to do', () => {
    for (const step of [1, 2, 3, 4, 5]) {
      expect(awaitingReview('bank', step)).toBe(false);
    }
  });

  it('is true once only our steps remain', () => {
    expect(awaitingReview('bank', 6)).toBe(true);
    expect(awaitingReview('bank', 7)).toBe(true);
  });

  it('stays true past the end of the wizard', () => {
    // The state that produced the dead-end banner: the cursor ran off the end,
    // the wizard called it complete and redirected, and the dashboard kept
    // telling them to continue.
    expect(awaitingReview('bank', 8)).toBe(true);
    expect(isComplete('bank', 8)).toBe(true);
  });

  it('never fires for a standard account, whose steps are all its own', () => {
    expect(awaitingReview('standard', totalSteps('standard'))).toBe(false);
  });
});
