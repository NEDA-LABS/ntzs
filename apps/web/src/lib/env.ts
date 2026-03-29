/**
 * Sanitize an environment variable value by stripping any surrounding quotes
 * that may have been accidentally included when setting the value in the
 * deployment platform (e.g. VALUE="https://..." instead of VALUE=https://...).
 */
function sanitizeEnv(value: string | undefined, fallback = ''): string {
  return (value || fallback).replace(/^["']|["']$/g, '')
}

export const BASE_RPC_URL = sanitizeEnv(
  process.env.BASE_RPC_URL,
  'https://mainnet.base.org'
)

export const NTZS_CONTRACT_ADDRESS_BASE = sanitizeEnv(
  process.env.NTZS_CONTRACT_ADDRESS_BASE ||
  process.env.NEXT_PUBLIC_NTZS_CONTRACT_ADDRESS_BASE,
  '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'
)

export const MINTER_PRIVATE_KEY = sanitizeEnv(process.env.MINTER_PRIVATE_KEY)
export const BURNER_PRIVATE_KEY = sanitizeEnv(process.env.BURNER_PRIVATE_KEY)
export const SNIPPE_API_KEY = sanitizeEnv(process.env.SNIPPE_API_KEY)
