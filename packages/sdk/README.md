# nTZS SDK

TypeScript SDK for the nTZS Wallet-as-a-Service API.

## Status

⚠️ **Not yet published to npm**

While we prepare the official npm package, you can use the REST API directly with `fetch` (see below).

## Quick Start (Direct API)

Until the SDK is published, use the REST API directly:

```typescript
const NTZS_API_KEY = 'your-api-key'
const NTZS_BASE_URL = 'https://api.ntzs.co'

// Create a user
const createUser = async (email: string) => {
  const response = await fetch(`${NTZS_BASE_URL}/api/v1/users`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NTZS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email })
  })
  return response.json()
}

// Get user balance
const getBalance = async (userId: string) => {
  const response = await fetch(`${NTZS_BASE_URL}/api/v1/users/${userId}`, {
    headers: {
      'Authorization': `Bearer ${NTZS_API_KEY}`
    }
  })
  return response.json()
}

// Create deposit (M-Pesa on-ramp)
const createDeposit = async (userId: string, amountTzs: number, phoneNumber: string) => {
  const response = await fetch(`${NTZS_BASE_URL}/api/v1/deposits`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NTZS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ userId, amountTzs, phoneNumber })
  })
  return response.json()
}

// Create withdrawal (M-Pesa off-ramp)
const createWithdrawal = async (userId: string, amountTzs: number, phoneNumber: string) => {
  const response = await fetch(`${NTZS_BASE_URL}/api/v1/withdrawals`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NTZS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ userId, amountTzs, phoneNumber })
  })
  return response.json()
}

// Transfer between users
const createTransfer = async (fromUserId: string, toUserId: string, amountTzs: number) => {
  const response = await fetch(`${NTZS_BASE_URL}/api/v1/transfers`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NTZS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fromUserId, toUserId, amountTzs })
  })
  return response.json()
}
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/users` | Create user + provision wallet |
| `GET` | `/api/v1/users/:userId` | Get user profile + balance |
| `POST` | `/api/v1/deposits` | Initiate M-Pesa deposit |
| `GET` | `/api/v1/deposits/:depositId` | Check deposit status |
| `POST` | `/api/v1/withdrawals` | Initiate M-Pesa withdrawal |
| `GET` | `/api/v1/withdrawals/:withdrawalId` | Check withdrawal status |
| `POST` | `/api/v1/transfers` | Transfer nTZS between users |
| `GET` | `/api/v1/supply` | Get total supply |
| `GET` | `/api/v1/reconcile` | Reconcile supply vs balances |

## Authentication

All requests require a Bearer token:

```typescript
headers: {
  'Authorization': `Bearer ${NTZS_API_KEY}`
}
```

Get your API key from the [nTZS Developer Portal](https://ntzs.co/developers).

## Coming Soon

The `@ntzs/sdk` npm package will be published soon with a typed TypeScript client. Same functionality, cleaner API:

```typescript
import { NtzsClient } from '@ntzs/sdk'

const client = new NtzsClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.ntzs.co'
})

const user = await client.users.create({ email: 'user@example.com' })
const balance = await client.users.getBalance(user.id)
```

## License

MIT
