# nTZS SDK

TypeScript SDK for the nTZS Wallet-as-a-Service API.

## Status

⚠️ **Not yet published to npm**

While we prepare the official npm package, you can use the REST API directly with `fetch` (see below).

## Production URL

**Base URL**: `https://www.ntzs.co.tz`

For testing, you can also use:
- **Testnet**: Same production URL (uses Base Sepolia testnet)
- **Local Development**: `http://localhost:3000`

Get your API key from the [nTZS Developer Portal](https://ntzs.co/developers).

## Quick Start (Direct API)

Until the SDK is published, use the REST API directly:

```typescript
const NTZS_API_KEY = 'your-api-key'
const NTZS_BASE_URL = 'https://www.ntzs.co.tz'

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

// Create deposit — mobile money (M-Pesa on-ramp)
const createMobileDeposit = async (userId: string, amountTzs: number, phoneNumber: string) => {
  const response = await fetch(`${NTZS_BASE_URL}/api/v1/deposits`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NTZS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ userId, amountTzs, paymentMethod: 'mobile_money', phoneNumber })
  })
  return response.json()
  // Response: { id, status, amountTzs, paymentMethod, instructions }
}

// Create deposit — card (hosted redirect flow)
const createCardDeposit = async (userId: string, amountTzs: number, redirectUrl: string, cancelUrl: string) => {
  const response = await fetch(`${NTZS_BASE_URL}/api/v1/deposits`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NTZS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ userId, amountTzs, paymentMethod: 'card', redirectUrl, cancelUrl })
  })
  return response.json()
  // Response: { id, status, amountTzs, paymentMethod, paymentUrl }
  // Redirect your user to paymentUrl to complete payment.
  // On success, Snippe fires a webhook and nTZS is minted automatically.
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
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(`Transfer failed: ${error.message} (${error.error})`)
  }
  
  return response.json()
}
```

## Transfer API Details

### Request Schema
```typescript
{
  fromUserId: string    // Sender's user ID
  toUserId: string      // Recipient's user ID
  amountTzs: number     // Amount in TZS (will be converted to nTZS)
  metadata?: object     // Optional metadata
}
```

### Success Response (201)
```typescript
{
  id: string                 // Transfer ID
  status: "completed"        // Transfer status
  txHash: string            // Blockchain transaction hash
  amountTzs: number         // Total amount transferred
  recipientAmountTzs: number // Amount received (after fees)
  feeAmountTzs: number      // Platform fee amount
  feeTxHash: string | null  // Fee transaction hash (if applicable)
}
```

### Error Responses

All errors follow this structure:
```typescript
{
  error: string      // Error code (see below)
  message: string    // Human-readable message
  details?: object   // Additional context
}
```

**Error Codes:**

| Code | Status | Description | Solution |
|------|--------|-------------|----------|
| `missing_required_fields` | 400 | Missing fromUserId, toUserId, or amountTzs | Provide all required fields |
| `invalid_amount` | 400 | Amount is zero or negative | Use positive amount |
| `invalid_transfer` | 400 | Attempting to transfer to self | Use different recipient |
| `user_not_found` | 404 | Sender or recipient not found | Verify user IDs |
| `wallet_not_provisioned` | 400 | User wallet not yet created | Wait for wallet provisioning to complete |
| `insufficient_balance` | 400 | Sender has insufficient nTZS | Check balance before transfer |
| `insufficient_gas` | 400 | Sender wallet has no ETH for gas | Contact support for gas funding |
| `configuration_error` | 500 | Blockchain config missing | Contact support |
| `network_error` | 500 | Blockchain network issue | Retry in a few moments |
| `contract_error` | 500 | Smart contract rejected transaction | Contact support |
| `blockchain_error` | 500 | Other blockchain error | Contact support |

### Requirements

Before making a transfer, ensure:

1. **Both users exist** - Created via `POST /api/v1/users`
2. **Wallets are provisioned** - Check that wallet addresses don't start with `0x_pending_`
3. **Sender has sufficient balance** - Check via `GET /api/v1/users/:userId`
4. **Sender has ETH for gas** - Wallets need ~0.001 ETH for gas fees (contact support for funding)

### Example: Complete Transfer Flow

```typescript
// 1. Check sender balance
const sender = await fetch(`${NTZS_BASE_URL}/api/v1/users/${fromUserId}`, {
  headers: { 'Authorization': `Bearer ${NTZS_API_KEY}` }
}).then(r => r.json())

if (sender.balanceTzs < amountTzs) {
  throw new Error('Insufficient balance')
}

// 2. Verify wallet is provisioned
if (!sender.walletAddress || sender.walletAddress.startsWith('0x_pending_')) {
  throw new Error('Wallet not provisioned yet')
}

// 3. Execute transfer
const transfer = await fetch(`${NTZS_BASE_URL}/api/v1/transfers`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${NTZS_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ fromUserId, toUserId, amountTzs })
}).then(r => r.json())

console.log(`Transfer completed: ${transfer.txHash}`)
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
  baseUrl: 'https://www.ntzs.co.tz'
})

const user = await client.users.create({ email: 'user@example.com' })
const balance = await client.users.getBalance(user.id)
```

## License

MIT
