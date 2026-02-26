// ─── User Types ─────────────────────────────────────────────────────────────

export interface NtzsUser {
  id: string
  externalId: string
  email: string
  phone: string | null
  walletAddress: string | null
  balance: number
}

export interface NtzsUserWithBalance {
  id: string
  externalId: string
  email: string
  phone: string | null
  walletAddress: string | null
  balanceTzs: number
}

export interface NtzsBalance {
  balanceTzs: number
  walletAddress: string
}

export interface CreateUserParams {
  externalId: string
  email: string
  phone?: string
}

// ─── Deposit Types ──────────────────────────────────────────────────────────

export interface NtzsDeposit {
  id: string
  status: string
  amountTzs: number
  txHash?: string | null
  instructions?: string
  createdAt?: string
}

export interface CreateDepositParams {
  userId: string
  amountTzs: number
  phoneNumber: string
}

// ─── Withdrawal Types ───────────────────────────────────────────────────────

export interface NtzsWithdrawal {
  id: string
  status: string
  amountTzs: number
  txHash?: string | null
  payoutStatus?: string
  payoutError?: string | null
  message?: string
  createdAt?: string
}

export interface CreateWithdrawalParams {
  userId: string
  amountTzs: number
  phoneNumber: string
}

// ─── Transfer Types ─────────────────────────────────────────────────────────

export interface NtzsTransfer {
  id: string
  status: string
  txHash?: string | null
  amountTzs: number
}

export interface CreateTransferParams {
  fromUserId: string
  toUserId: string
  amountTzs: number
  metadata?: Record<string, unknown>
}

// ─── Supply Types ───────────────────────────────────────────────────────────

export interface NtzsSupply {
  totalSupplyTzs: number
  contractAddress: string
  chain: string
}

export interface NtzsReconciliation {
  onChainSupplyTzs: number
  dbTotalBalanceTzs: number
  difference: number
  isReconciled: boolean
  walletsChecked: number
  contractAddress: string
  chain: string
}

// ─── Error Types ────────────────────────────────────────────────────────────

export interface NtzsApiError {
  error: string
  status: number
}

// ─── Client Config ──────────────────────────────────────────────────────────

export interface NtzsClientConfig {
  apiKey: string
  baseUrl: string
}
