import { describe, it, expect } from 'vitest';

import { isRoutable } from './lp-eligibility';

describe('isRoutable', () => {
  it('routes an active LP', () => {
    expect(isRoutable({ isActive: true, status: 'active' })).toBe(true);
  });

  it('still routes an LP whose status lags in onboarding', () => {
    // Every LP that has filled an order to date sits here. Requiring 'active'
    // instead of excluding 'suspended' would have taken the market offline.
    expect(isRoutable({ isActive: true, status: 'onboarding' })).toBe(true);
  });

  it('refuses a suspended LP even while its capital is pooled', () => {
    // The whole point: suspension used to change a badge while the account
    // carried on filling orders, because selection asked isActive and nothing else.
    expect(isRoutable({ isActive: true, status: 'suspended' })).toBe(false);
  });

  it('refuses an LP with no capital in the pool', () => {
    expect(isRoutable({ isActive: false, status: 'active' })).toBe(false);
  });
});
