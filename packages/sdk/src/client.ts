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
  SwapRate,
  SwapRateParams,
  CreateSwapParams,
  SwapStatusUpdate,
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

  // ─── Swap ──────────────────────────────────────────────────────────────

  readonly swap = {
    /**
     * Get the current exchange rate for a swap pair.
     * Public endpoint — no auth required, but auth is accepted.
     */
    getRate: (params: SwapRateParams): Promise<SwapRate> => {
      const qs = new URLSearchParams({
        from: params.from,
        to: params.to,
        amount: String(params.amount),
      })
      return this.get<SwapRate>(`/api/v1/swap/rate?${qs}`)
    },

    /**
     * Execute a swap for a user. Returns an async generator that yields
     * real-time status updates via SSE.
     *
     * Terminal statuses: FILLED (success), FAILED, PARTIAL_FILL_EXHAUSTED
     *
     * @example
     * ```ts
     * for await (const update of ntzs.swap.execute({ userId, fromToken: 'USDC', toToken: 'NTZS', amount: 5 })) {
     *   console.log(update.status, update.message)
     *   if (update.status === 'FILLED') console.log('tx:', update.txHash)
     * }
     * ```
     */
    execute: (params: CreateSwapParams): AsyncGenerator<SwapStatusUpdate> => {
      return this.streamSwap(params)
    },
  }

  private async *streamSwap(params: CreateSwapParams): AsyncGenerator<SwapStatusUpdate> {
    const url = `${this.baseUrl}/api/v1/swap`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new NtzsApiError(
        (data as { error?: string }).error || `HTTP ${response.status}`,
        response.status,
        data,
      )
    }

    const reader = response.body?.getReader()
    if (!reader) throw new NtzsApiError('No response body', 500, {})

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const update: SwapStatusUpdate = JSON.parse(line.slice(6))
          yield update
          if (update.status === 'FILLED' || update.status === 'FAILED' || update.status === 'PARTIAL_FILL_EXHAUSTED') {
            return
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  }
}

export { NtzsApiError }
