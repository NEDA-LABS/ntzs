import { NextResponse } from 'next/server'

/**
 * Capability registry — the single source of truth for our composable platform.
 *
 * A partner enables the capabilities their use case needs; the dashboard nav,
 * API enforcement, docs, and onboarding all derive from this list. Adding a new
 * API product = adding a capability here (+ its section/docs), not a new app.
 *
 * "Products" like WaaS / Ramp are just presets (capability bundles), not boxes.
 */

export type Capability =
  | 'wallets'
  | 'collections'
  | 'disbursements'
  | 'transfers'
  | 'treasury'
  | 'swap'
  | 'ramp'

export interface CapabilityDef {
  id: Capability
  label: string
  /** One-line, customer-facing description (use-case framing, not jargon). */
  description: string
  /** Whether enabling this capability requires approved KYB (money movement). */
  kybRequired: boolean
  /** Slug for the per-capability docs page under /developers/docs. */
  docsSlug: string
}

export const CAPABILITIES: Record<Capability, CapabilityDef> = {
  wallets: {
    id: 'wallets', label: 'Wallets', docsSlug: 'wallets', kybRequired: false,
    description: 'Create and manage end-user wallets (HD) for your customers.',
  },
  collections: {
    id: 'collections', label: 'Collections', docsSlug: 'collections', kybRequired: true,
    description: 'Collect funds (T+0) from all mobile-money networks and banks.',
  },
  disbursements: {
    id: 'disbursements', label: 'Disbursements', docsSlug: 'disbursements', kybRequired: true,
    description: 'Pay out to mobile money or banks — single payouts or bulk runs.',
  },
  transfers: {
    id: 'transfers', label: 'Transfers', docsSlug: 'transfers', kybRequired: false,
    description: 'Move value between your users and external addresses on-chain.',
  },
  treasury: {
    id: 'treasury', label: 'Treasury', docsSlug: 'treasury', kybRequired: false,
    description: 'Hold and manage balances and sub-wallets for your business.',
  },
  swap: {
    id: 'swap', label: 'Swap', docsSlug: 'swap', kybRequired: false,
    description: 'Convert between USDC and nTZS at a live rate.',
  },
  ramp: {
    id: 'ramp', label: 'Ramp', docsSlug: 'ramp', kybRequired: true,
    description: 'Wallet-less settlement: USDC ⇄ mobile money, no per-user wallets.',
  },
}

export const ALL_CAPABILITIES = Object.keys(CAPABILITIES) as Capability[]

/** Named starting bundles for onboarding/ops. A preset just selects a set. */
export const CAPABILITY_PRESETS: Record<string, { label: string; capabilities: Capability[] }> = {
  collections: { label: 'Collections', capabilities: ['collections', 'treasury'] },
  disbursements: { label: 'Disbursements', capabilities: ['disbursements', 'treasury'] },
  settlement: { label: 'Settlement (Ramp)', capabilities: ['ramp'] },
  wallet_platform: { label: 'Wallet platform', capabilities: ['wallets', 'collections', 'disbursements', 'transfers', 'treasury', 'swap'] },
  custom: { label: 'Custom', capabilities: [] },
}

/**
 * Resolve a partner's effective capabilities. NULL/empty = legacy partner →
 * the full set (backward compatibility, so nothing they use today disappears).
 */
export function resolveCapabilities(raw: string[] | null | undefined): Capability[] {
  if (!raw || raw.length === 0) return [...ALL_CAPABILITIES]
  return raw.filter((c): c is Capability => c in CAPABILITIES)
}

export function hasCapability(raw: string[] | null | undefined, cap: Capability): boolean {
  return resolveCapabilities(raw).includes(cap)
}

/** 403 response for a missing capability (consistent copy across endpoints). */
export function capabilityError(cap: Capability): NextResponse {
  return NextResponse.json(
    { error: `This endpoint requires the '${cap}' capability, which isn't enabled for your account. Request access in the developer dashboard.` },
    { status: 403 },
  )
}
