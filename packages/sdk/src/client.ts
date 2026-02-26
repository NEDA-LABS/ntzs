import type {
  NtzsClientConfig,
  NtzsUser,
  NtzsUserWithBalance,
  NtzsBalance,
  CreateUserParams,
  NtzsDeposit,
  CreateDepositParams,
  NtzsWithdrawal,
  CreateWithdrawalParams,
  NtzsTransfer,
  CreateTransferParams,
  NtzsSupply,
  NtzsReconciliation,
} from './types.js'

class NtzsApiError extends Error {
  status: number
  body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'NtzsApiError'
    this.status = status
    this.body = body
  }
}

export class NtzsClient {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(config: NtzsClientConfig) {
    if (!config.apiKey) throw new Error('apiKey is required')
    if (!config.baseUrl) throw new Error('baseUrl is required')

    this.apiKey = config.apiKey
    // Remove trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
  }

  // ─── Internal HTTP helpers ──────────────────────────────────────────────

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }

    const init: RequestInit = { method, headers }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }

    const response = await fetch(url, init)
    const data = await response.json()

    if (!response.ok) {
      throw new NtzsApiError(
        (data as { error?: string }).error || `HTTP ${response.status}`,
        response.status,
        data
      )
    }

    return data as T
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  // ─── Users ──────────────────────────────────────────────────────────────

  readonly users = {
    /**
     * Create a new user and provision an embedded wallet
     */
    create: (params: CreateUserParams): Promise<NtzsUser> => {
      return this.post<NtzsUser>('/api/v1/users', params)
    },

    /**
     * Get user profile and nTZS balance
     */
    get: (userId: string): Promise<NtzsUserWithBalance> => {
      return this.get<NtzsUserWithBalance>(`/api/v1/users/${userId}`)
    },

    /**
     * Get user's nTZS balance (reads on-chain balanceOf)
     */
    getBalance: (userId: string): Promise<NtzsBalance> => {
      return this.get<NtzsUserWithBalance>(`/api/v1/users/${userId}`).then((u) => ({
        balanceTzs: u.balanceTzs,
        walletAddress: u.walletAddress || '',
      }))
    },
  }

  // ─── Deposits ───────────────────────────────────────────────────────────

  readonly deposits = {
    /**
     * Initiate an M-Pesa deposit (on-ramp)
     */
    create: (params: CreateDepositParams): Promise<NtzsDeposit> => {
      return this.post<NtzsDeposit>('/api/v1/deposits', params)
    },

    /**
     * Check deposit status
     */
    get: (depositId: string): Promise<NtzsDeposit> => {
      return this.get<NtzsDeposit>(`/api/v1/deposits/${depositId}`)
    },
  }

  // ─── Withdrawals ────────────────────────────────────────────────────────

  readonly withdrawals = {
    /**
     * Initiate nTZS burn + Snippe payout to M-Pesa (off-ramp)
     */
    create: (params: CreateWithdrawalParams): Promise<NtzsWithdrawal> => {
      return this.post<NtzsWithdrawal>('/api/v1/withdrawals', params)
    },

    /**
     * Check withdrawal status
     */
    get: (withdrawalId: string): Promise<NtzsWithdrawal> => {
      return this.get<NtzsWithdrawal>(`/api/v1/withdrawals/${withdrawalId}`)
    },
  }

  // ─── Transfers ──────────────────────────────────────────────────────────

  readonly transfers = {
    /**
     * Transfer nTZS between two users within the platform
     */
    create: (params: CreateTransferParams): Promise<NtzsTransfer> => {
      return this.post<NtzsTransfer>('/api/v1/transfers', params)
    },
  }

  // ─── Supply ─────────────────────────────────────────────────────────────

  readonly supply = {
    /**
     * Get on-chain totalSupply of nTZS
     */
    get: (): Promise<NtzsSupply> => {
      return this.get<NtzsSupply>('/api/v1/supply')
    },

    /**
     * Compare on-chain totalSupply vs sum of all user balances
     */
    reconcile: (): Promise<NtzsReconciliation> => {
      return this.get<NtzsReconciliation>('/api/v1/reconcile')
    },
  }
}

export { NtzsApiError }
