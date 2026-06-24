/**
 * SimpleFX onboarding registry — single source of truth for the step machine.
 *
 * `lp_accounts.onboardingStep` is a 1-indexed cursor; when it exceeds the number
 * of steps for the account type, onboarding is complete. The wizard UI and the
 * onboarding API both derive from here, so adding/reordering a step is a one-place
 * change.
 */
export type AccountType = 'standard' | 'bank'

export interface OnboardingStepDef {
  key: string
  label: string
  description: string
}

export const ONBOARDING_STEPS: Record<AccountType, OnboardingStepDef[]> = {
  standard: [
    { key: 'profile', label: 'Profile', description: 'Tell us who you are.' },
    { key: 'spread', label: 'Set FX spread', description: 'Choose your bid/ask margin.' },
    { key: 'fund', label: 'Fund & activate', description: 'Deposit liquidity and go live.' },
  ],
  bank: [
    { key: 'profile', label: 'Organisation', description: 'Your institution’s details.' },
    { key: 'kyb', label: 'KYB documents', description: 'Licence, ownership, AML policy, signatories.' },
    { key: 'banking', label: 'Banking & reserve', description: 'Trust account and settlement details.' },
    { key: 'fx', label: 'FX configuration', description: 'Spread and exposure limits.' },
    { key: 'team', label: 'Team & roles', description: 'Invite an operator and an approver.' },
    { key: 'sandbox', label: 'Sandbox test', description: 'Run a guided test settlement.' },
    { key: 'golive', label: 'Go live', description: 'Final review and activation.' },
  ],
}

export function isAccountType(v: unknown): v is AccountType {
  return v === 'standard' || v === 'bank'
}

/** Required KYB documents for the bank onboarding path (shared by API + UI). */
export interface KybDocType {
  key: string
  label: string
  hint: string
}

export const KYB_DOC_TYPES: KybDocType[] = [
  { key: 'regulatory_license', label: 'Banking licence', hint: 'Your Bank of Tanzania operating licence.' },
  { key: 'ownership_ubo', label: 'Ownership / UBO', hint: 'Beneficial-ownership register.' },
  { key: 'aml_policy', label: 'AML / CFT policy', hint: 'Your current AML/CFT policy.' },
  { key: 'authorized_signatories', label: 'Authorised signatories', hint: 'Named signatories and their IDs.' },
]

export const KYB_DOC_KEYS: string[] = KYB_DOC_TYPES.map((d) => d.key)

export function stepsFor(type: AccountType): OnboardingStepDef[] {
  return ONBOARDING_STEPS[type]
}

export function totalSteps(type: AccountType): number {
  return ONBOARDING_STEPS[type].length
}

/** Onboarding is done once the cursor passes the last step. */
export function isComplete(type: AccountType, step: number): boolean {
  return step > totalSteps(type)
}

/** Keep the cursor within [1, total + 1] (total + 1 = complete). */
export function clampStep(type: AccountType, step: number): number {
  return Math.max(1, Math.min(Math.trunc(step), totalSteps(type) + 1))
}

/** The full state the API returns (and the wizard renders from). */
export function onboardingState(type: AccountType, step: number) {
  return {
    accountType: type,
    step,
    total: totalSteps(type),
    complete: isComplete(type, step),
    steps: stepsFor(type).map((s, i) => ({ ...s, index: i + 1 })),
  }
}
