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

export type TransferToken = 'NTZS' | 'USDC'

export interface NtzsTransfer {
  id: string
  status: string
  txHash?: string | null
  token?: TransferToken | 'ntzs' | 'usdc'
  amount?: number
  recipientAmount?: number
  feeAmount?: number
  feeTxHash?: string | null
  toAddress?: string
  /** Legacy alias — populated for nTZS transfers only */
  amountTzs?: number
  /** Legacy alias — populated for nTZS transfers only */
  recipientAmountTzs?: number
  /** Legacy alias — populated for nTZS transfers only */
  feeAmountTzs?: number
}

export interface CreateTransferParams {
  fromUserId: string
  /** Either toUserId (platform user) or toAddress (external wallet) */
  toUserId?: string
  toAddress?: string
  /** Token to transfer — defaults to NTZS when omitted */
  token?: TransferToken
  /** Token-agnostic amount. Preferred over amountTzs. */
  amount?: number
  /** Legacy field — only valid when token is NTZS (or omitted) */
  amountTzs?: number
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

// ─── Swap Types ─────────────────────────────────────────────────────────────

export type SwapToken = 'NTZS' | 'USDC'

export interface SwapRateParams {
  from: SwapToken
  to: SwapToken
  amount: number
}

export interface SwapRate {
  from: SwapToken
  to: SwapToken
  amount: number
  midRate: number
  bidBps: number
  askBps: number
  expectedOutput: number
  minOutput: number
  rate: number
  expiresAt: string
}

export interface CreateSwapParams {
  userId: string
  fromToken: SwapToken
  toToken: SwapToken
  amount: number
  slippageBps?: number
}

export interface SwapStatusUpdate {
  status: string
  message: string
  txHash?: string
  error?: string
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
